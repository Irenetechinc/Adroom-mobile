// LISTEN FOR MESSAGES
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startAnalysis") {
    
    // Call the async function and handle the response
    processDossier()
      .then(() => {
        sendResponse({ status: "success" });
      })
      .catch((error) => {
        sendResponse({ status: "error", message: error.message });
      });

    return true; 
  }
});

async function processDossier() {
  try {
    console.log("1. Starting Dossier Process...");
    
    // --- SETUP ---
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const currentUrl = tabs[0].url;
    const keyData = await browser.storage.local.get('groq_key');
    const apiKey = keyData.groq_key;

    if (!apiKey) throw new Error("No Groq API Key found.");

    const urlParts = currentUrl.split('/user/');
    if (urlParts.length < 2) throw new Error("Not a valid user profile URL.");
    const username = urlParts[1].split('/')[0];

    // --- FETCH DATA ---
    console.log(`Fetching data for: ${username}`);

    // 1. Metadata (Avatar/Bio)
    const aboutRes = await fetch(`https://www.reddit.com/user/${username}/about.json`);
    const aboutJson = await aboutRes.json();
    const aboutData = aboutJson.data;

    let avatar = aboutData.icon_img || "";
    avatar = avatar.replace(/&amp;/g, "&"); 
    const bio = aboutData.subreddit ? (aboutData.subreddit.public_description || "N/A") : "N/A";

    // 2. Activity (Posts AND Comments)
    // Fetching 'overview' gets both t1 (comments) and t3 (posts)
    const contentRes = await fetch(`https://www.reddit.com/user/${username}.json?limit=75`);
    const contentJson = await contentRes.json();
    
    let activityLog = []; // Stores formatted strings of both posts and comments
    let subredditCounts = {};
    let lastActivity = "No recent activity.";

    // Helper to truncate massive text blocks to save tokens
    const truncate = (str, len = 600) => {
      if (!str) return "";
      return str.length > len ? str.substring(0, len) + "...(truncated)" : str;
    };

    contentJson.data.children.forEach((item) => {
      const data = item.data;
      const subreddit = data.subreddit;
      
      // Track Subreddit Frequency
      subredditCounts[subreddit] = (subredditCounts[subreddit] || 0) + 1;

      let entry = "";

      // HANDLE COMMENT (t1)
      if (item.kind === 't1') {
        const body = truncate(data.body);
        entry = `[r/${subreddit}] [COMMENT]: ${body}`;
        
        // Save first item for the footer
        if (activityLog.length === 0) lastActivity = `[Comment in r/${subreddit}] ${body}`;
      } 
      
      // HANDLE POST (t3)
      else if (item.kind === 't3') {
        const title = data.title;
        const selftext = truncate(data.selftext); // Post body
        
        // Format: Title + Body
        const content = selftext ? `Title: ${title} | Body: ${selftext}` : `Title: ${title}`;
        entry = `[r/${subreddit}] [POST]: ${content}`;

        // Save first item for the footer
        if (activityLog.length === 0) lastActivity = `[Post in r/${subreddit}] ${title}`;
      }

      if (entry) activityLog.push(entry);
    });

    // Calculate Top Subreddits
    const topSubreddits = Object.entries(subredditCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(entry => `${entry[0]} (${entry[1]})`)
      .join(", ");

    // --- LLM INFERENCE ---
    console.log("Sending request to Groq...");

    const systemPrompt = `
    You are an expert FBI-style profiler performing an OSINT-style analysis of a Reddit user's public activity. Analyze the Reddit user data provided.
    
    Return ONLY a raw JSON object (no markdown, no code blocks).
    
    Follow this exact schema:
    {
      "demographics": {
        "age": "Estimated Age Range or N/A",
        "gender": "Male/Female/Unknown",
        "location": "City/Country or N/A",
        "language": "List of suspected spoken languages",
        "occupation": "Estimated Occupation/Field or N/A",
        "organization": "Company/University or N/A, look specifically for University Subreddits",
        "interests": "Comma separated list of top 4 interests"
      },
      "activity_overview": {
        "top_subreddits": "List of most active subreddits",
        "post_frequency": "Daily/Weekly/Monthly estimate",
        "active_hours": "Typical posting hours or N/A",
        "engagement_style": "E.g., helper, debater, lurker, shitposter, etc.",
        "content_types": "Posts, comments, media, code, etc."
      },
      "linguistic_style": {
        "formality": "Formal/Neutral/Casual/Mixed",
        "sentiment_tendencies": "Overall tone patterns",
        "vocabulary_traits": "Technical, humorous, academic, hostile, etc.",
        "writing_characteristics": "Long/short form, structured, slang usage, etc."
      },
      "interests_and_expertise": {
        "core_domains": "High-level interest categories inferred",
        "specialized_knowledge": "Any areas where expertise is evident",
        "recurring_topics": "Common discussion themes"
      },
      "behavioral_patterns": {
        "community_role": "Helper/Expert/Seeker/Debater/etc.",
        "conflict_behavior": "Argumentative, diplomatic, avoidant, etc.",
        "emotional_indicators": "High-level emotional tendencies",
        "ideological_indicators": "If expressed publicly; otherwise N/A"
      },
      "network_interactions": {
        "interaction_patterns": "Frequent interactions, clusters, or N/A",
        "subreddit_community_affinities": "Communities where they 'fit in' most"
      },
      "temporal_trends": {
        "activity_trends": "Increasing, decreasing, or stable participation",
        "notable_shifts": "Shifts in interests or tone over time"
      },
      "psychological_profile": "A 2–3 paragraph HTML formatted professional summary synthesizing personality traits, behavioral tendencies, and emotional profile. Use <p> tags."
    }`;

    const userContext = `
      Target: ${username}
      Bio: ${bio}
      Subreddit Activity Stats: ${topSubreddits}
      
      RECENT ACTIVITY LOG (Chronological): 
      ${activityLog.join("\n---\n")}
    `;

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContext }
        ],
        temperature: 1,
        max_completion_tokens: 8192,
        top_p: 1,
        stream: false,
        response_format: { type: "json_object" }
      })
    });

    const groqJson = await groqResponse.json();
    if (groqJson.error) throw new Error(groqJson.error.message);

    let rawContent = groqJson.choices[0].message.content;
    
    // Cleanup Logic
    let parsedAI;
    try {
        parsedAI = JSON.parse(rawContent);
    } catch (e) {
        console.warn("Parsing failed, attempting cleanup...");
        rawContent = rawContent.replace(/^```json/gm, '').replace(/^```/gm, '').replace(/```$/gm, '');
        parsedAI = JSON.parse(rawContent);
    }

    const finalData = {
      username: username,
      date: new Date().toLocaleString(),
      avatar: avatar,
      bio: bio,
      lastComment: lastActivity, // Now reflects either post or comment
      ai_data: parsedAI
    };

    await browser.storage.local.set({ 'dossierReport': finalData });
    browser.tabs.create({ url: "dossier.html" });

  } catch (error) {
    console.error(error);
    await browser.storage.local.set({ 'dossierReport': { error: error.message } });
    browser.tabs.create({ url: "dossier.html" });
    throw error; // Re-throw to trigger the .catch in the listener
  }
}