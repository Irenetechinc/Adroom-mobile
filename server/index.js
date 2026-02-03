const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Env Vars
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase Client
const supabase = createClient(SUPABASE_URL || '', SUPABASE_SERVICE_ROLE_KEY || '');

// Health Check
app.get('/', (req, res) => {
  res.send('AdRoom Worker is running');
});

// Main Event Handler Endpoint
app.post('/webhook', async (req, res) => {
  try {
    const { type, record, table } = req.body;
    console.log(`Received event: ${type} on ${table}`);

    // 1. Handle New Comments
    if (table === 'comments' && type === 'INSERT') {
      await handleNewComment(record);
    }
    
    // 2. Handle New Messages
    else if (table === 'messages' && type === 'INSERT') {
      await handleNewMessage(record);
    }

    // 3. Handle Scheduled Task (Lead Follow-up)
    // Note: For Railway, we might use a separate endpoint triggered by a cron job service
    else if (type === 'SCHEDULED_TASK') {
        await handleScheduledTasks();
    }

    res.status(200).json({ message: 'Processed successfully' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Logic Handlers ---

async function handleNewComment(comment) {
    console.log(`Processing comment: ${comment.id}`);
    
    // 1. Get Facebook Config for the user
    const { data: config } = await supabase
        .from('ad_configs')
        .select('*')
        .eq('user_id', comment.user_id)
        .single();

    if (!config) {
        console.log('No FB config found for user');
        return;
    }

    // 2. Like the comment
    if (!comment.is_liked) {
        await likeObject(comment.external_id, config.access_token);
        await supabase.from('comments').update({ is_liked: true }).eq('id', comment.id);
    }

    // 3. Generate and Post Reply
    if (!comment.is_replied) {
        const reply = await generateAIResponse(comment.content, 'comment');
        await postComment(comment.external_id, reply, config.access_token);
        
        await supabase.from('comments').update({ 
            is_replied: true,
            reply_content: reply
        }).eq('id', comment.id);
    }
}

async function handleNewMessage(msg) {
    console.log(`Processing message: ${msg.id}`);
    
    // Ignore messages from the page itself
    if (msg.is_from_page) return;

    const { data: config } = await supabase
        .from('ad_configs')
        .select('*')
        .eq('user_id', msg.user_id)
        .single();

    if (!config) return;

    if (!msg.is_replied) {
        const reply = await generateAIResponse(msg.content, 'message');
        await postMessage(msg.conversation_id, reply, config.access_token);
        
        await supabase.from('messages').update({ is_replied: true }).eq('id', msg.id);
    }
}

async function handleScheduledTasks() {
    // Lead Follow-up Logic
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: leads } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'contacted')
        .lt('last_interaction', yesterday)
        .limit(10);

    if (leads && leads.length > 0) {
        for (const lead of leads) {
            console.log(`Following up lead: ${lead.id}`);
            // In a real scenario, we'd send a message via the platform the lead came from
            // For now, we update the status and log it
            await supabase.from('leads').update({
                status: 'follow_up_sent',
                last_interaction: new Date().toISOString(),
                notes: 'Auto follow-up sent via Railway Worker'
            }).eq('id', lead.id);
        }
    }
}

// --- AI Service ---

async function generateAIResponse(input, context) {
    if (!OPENAI_API_KEY) return "Thanks for reaching out!";

    const systemPrompt = context === 'comment' 
        ? "You are an engaging human social media manager. Reply to the comment naturally. Keep it short. Do NOT sound like a bot."
        : "You are a helpful customer support agent for the brand. Reply to the DM warmly and helpfully. Do NOT sound like a bot.";

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
        });
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (e) {
        console.error('AI Error:', e);
        return "Thank you!";
    }
}

// --- Facebook API Helpers ---

async function likeObject(objectId, token) {
    try {
        await fetch(`https://graph.facebook.com/v18.0/${objectId}/likes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: token })
        });
    } catch (e) {
        console.error('FB Like Error:', e);
    }
}

async function postComment(objectId, message, token) {
    try {
        await fetch(`https://graph.facebook.com/v18.0/${objectId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, access_token: token })
        });
    } catch (e) {
        console.error('FB Comment Error:', e);
    }
}

async function postMessage(conversationId, message, token) {
    try {
        await fetch(`https://graph.facebook.com/v18.0/${conversationId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_text: message, access_token: token })
        });
    } catch (e) {
        console.error('FB Message Error:', e);
    }
}

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
