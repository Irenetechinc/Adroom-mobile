// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      SUPABASE_URL ?? '',
      SUPABASE_SERVICE_ROLE_KEY ?? ''
    )

    const { type, record, table, schema } = await req.json()

    console.log(`Received event: ${type} on ${table}`)

    // 1. Handle New Comments
    if (table === 'comments' && type === 'INSERT') {
      await handleNewComment(supabase, record)
    }
    
    // 2. Handle New Messages
    else if (table === 'messages' && type === 'INSERT') {
      await handleNewMessage(supabase, record)
    }

    // 3. Handle Scheduled Task (Lead Follow-up)
    else if (type === 'SCHEDULED_TASK') {
        await handleScheduledTasks(supabase)
    }

    return new Response(JSON.stringify({ message: 'Processed successfully' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

// --- Logic Handlers ---

async function handleNewComment(supabase: any, comment: any) {
    console.log(`Processing comment: ${comment.id}`)
    
    // 1. Get Facebook Config for the user
    const { data: config } = await supabase
        .from('ad_configs')
        .select('*')
        .eq('user_id', comment.user_id)
        .single()

    if (!config) {
        console.log('No FB config found for user')
        return
    }

    // 2. Like the comment
    if (!comment.is_liked) {
        await likeObject(comment.external_id, config.access_token)
        await supabase.from('comments').update({ is_liked: true }).eq('id', comment.id)
    }

    // 3. Generate and Post Reply
    if (!comment.is_replied) {
        const reply = await generateAIResponse(comment.content, 'comment')
        await postComment(comment.external_id, reply, config.access_token)
        
        await supabase.from('comments').update({ 
            is_replied: true,
            reply_content: reply
        }).eq('id', comment.id)
    }
}

async function handleNewMessage(supabase: any, msg: any) {
    console.log(`Processing message: ${msg.id}`)
    
    // Ignore messages from the page itself
    if (msg.is_from_page) return

    const { data: config } = await supabase
        .from('ad_configs')
        .select('*')
        .eq('user_id', msg.user_id)
        .single()

    if (!config) return

    if (!msg.is_replied) {
        const reply = await generateAIResponse(msg.content, 'message')
        await postMessage(msg.conversation_id, reply, config.access_token)
        
        await supabase.from('messages').update({ is_replied: true }).eq('id', msg.id)
    }
}

async function handleScheduledTasks(supabase: any) {
    // Lead Follow-up Logic
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    
    const { data: leads } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'contacted')
        .lt('last_interaction', yesterday)
        .limit(10)

    if (leads && leads.length > 0) {
        for (const lead of leads) {
            console.log(`Following up lead: ${lead.id}`)
            // In a real scenario, we'd send a message via the platform the lead came from
            // For now, we update the status and log it
            await supabase.from('leads').update({
                status: 'follow_up_sent',
                last_interaction: new Date().toISOString(),
                notes: 'Auto follow-up sent via Edge Function'
            }).eq('id', lead.id)
        }
    }
}

// --- AI Service ---

async function generateAIResponse(input: string, context: 'comment' | 'message'): Promise<string> {
    if (!OPENAI_API_KEY) return "Thanks for reaching out!"

    const systemPrompt = context === 'comment' 
        ? "You are an engaging human social media manager. Reply to the comment naturally. Keep it short. Do NOT sound like a bot."
        : "You are a helpful customer support agent for the brand. Reply to the DM warmly and helpfully. Do NOT sound like a bot."

    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: input }
                ]
            })
        })
        const data = await res.json()
        return data.choices[0].message.content
    } catch (e) {
        console.error('AI Error:', e)
        return "Thank you!"
    }
}

// --- Facebook API Helpers ---

async function likeObject(objectId: string, token: string) {
    try {
        await fetch(`https://graph.facebook.com/v18.0/${objectId}/likes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: token })
        })
    } catch (e) {
        console.error('FB Like Error:', e)
    }
}

async function postComment(objectId: string, message: string, token: string) {
    try {
        await fetch(`https://graph.facebook.com/v18.0/${objectId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, access_token: token })
        })
    } catch (e) {
        console.error('FB Comment Error:', e)
    }
}

async function postMessage(conversationId: string, message: string, token: string) {
    try {
        await fetch(`https://graph.facebook.com/v18.0/${conversationId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_text: message, access_token: token })
        })
    } catch (e) {
        console.error('FB Message Error:', e)
    }
}
