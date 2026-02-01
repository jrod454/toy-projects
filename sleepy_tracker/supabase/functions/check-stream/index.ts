import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface TwitchStream {
  id: string;
  user_login: string;
  started_at: string;
}

interface TwitchStreamsResponse {
  data: TwitchStream[];
}

async function getTwitchAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: "POST" }
  );

  if (!response.ok) {
    throw new Error(`Failed to get Twitch token: ${response.status}`);
  }

  const data: TwitchTokenResponse = await response.json();
  return data.access_token;
}

async function checkStreamStatus(
  streamerName: string,
  clientId: string,
  accessToken: string
): Promise<TwitchStream | null> {
  const response = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${streamerName}`,
    {
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to check stream: ${response.status}`);
  }

  const data: TwitchStreamsResponse = await response.json();
  return data.data.length > 0 ? data.data[0] : null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const twitchClientId = Deno.env.get("TWITCH_CLIENT_ID")!;
    const twitchClientSecret = Deno.env.get("TWITCH_CLIENT_SECRET")!;
    const streamerName = Deno.env.get("STREAMER_NAME") || "1sleepyhomie";

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Twitch access token
    const accessToken = await getTwitchAccessToken(twitchClientId, twitchClientSecret);

    // Check if stream is live
    const stream = await checkStreamStatus(streamerName, twitchClientId, accessToken);
    const isLive = stream !== null;

    // Get current active session from database
    const { data: activeSession } = await supabase
      .from("sleepy_tracker_stream_sessions")
      .select("*")
      .eq("streamer_name", streamerName)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    let action = "none";

    if (isLive && !activeSession) {
      // Stream just went live - create new session
      const { error } = await supabase.from("sleepy_tracker_stream_sessions").insert({
        streamer_name: streamerName,
        started_at: stream!.started_at,
      });

      if (error) throw error;
      action = "started_session";
    } else if (!isLive && activeSession) {
      // Stream just ended - close the session
      const { error } = await supabase
        .from("sleepy_tracker_stream_sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", activeSession.id);

      if (error) throw error;
      action = "ended_session";
    } else if (isLive && activeSession) {
      action = "already_live";
    } else {
      action = "already_offline";
    }

    // Get current status for response
    const { data: status } = await supabase.rpc("sleepy_tracker_get_stream_status", {
      p_streamer_name: streamerName,
    });

    return new Response(
      JSON.stringify({
        success: true,
        action,
        is_live: isLive,
        started_at: stream?.started_at || null,
        status,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
