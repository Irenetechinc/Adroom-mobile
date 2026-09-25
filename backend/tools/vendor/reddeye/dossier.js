document.addEventListener('DOMContentLoaded', () => {
  browser.storage.local.get('dossierReport').then((data) => {
    const report = data.dossierReport;

    if (!report) {
      document.body.innerHTML = "<h1>Error: No Data Found</h1>";
      return;
    }
    if (report.error) {
      document.body.innerHTML = `<h1>Processing Error</h1><p>${report.error}</p>`;
      return;
    }

    // --- 1. BASICS ---
    document.title = "Profile Dossier - " + report.username;
    setText('username', report.username);
    setText('date', report.date);
    setText('bio', report.bio);
    // Truncate last comment if too long for footer
    let lc = report.lastComment || "N/A";
    if(lc.length > 100) lc = lc.substring(0, 100) + "...";
    setText('lastComment', lc);

    // Avatar
    const imgEl = document.getElementById('avatar');
    if (report.avatar) imgEl.src = report.avatar;
    else { imgEl.style.display = 'none'; imgEl.parentElement.innerText = "NO PHOTO"; }

    // --- 2. AI DATA ---
    const ai = report.ai_data || {};

    // A. Demographics (Direct Mapping)
    const demo = ai.demographics || {};
    setText('d_age', demo.age);
    setText('d_gender', demo.gender);
    setText('d_location', demo.location);
    setText('d_language', demo.language);
    setText('d_occupation', demo.occupation);
    setText('d_organization', demo.organization);
    setText('d_interests', demo.interests);

    // B. Modules (Dynamic List Builders)
    
    // Activity
    fillModule('activity-box', ai.activity_overview, {
      top_subreddits: "Top Subs",
      post_frequency: "Frequency",
      active_hours: "Active Hours",
      engagement_style: "Style",
      content_types: "Content"
    });

    // Linguistic
    fillModule('linguistic-box', ai.linguistic_style, {
      formality: "Formality",
      sentiment_tendencies: "Sentiment",
      vocabulary_traits: "Vocabulary",
      writing_characteristics: "Writing"
    });

    // Behavior
    fillModule('behavior-box', ai.behavioral_patterns, {
      community_role: "Role",
      conflict_behavior: "Conflict",
      emotional_indicators: "Emotional",
      ideological_indicators: "Ideology"
    });

    // Network & Temporal (Merged for space)
    const network = ai.network_interactions || {};
    const trends = ai.temporal_trends || {};
    const mergedNet = {
      ...network,
      ...trends
    };
    fillModule('network-box', mergedNet, {
      subreddit_community_affinities: "Affinities",
      interaction_patterns: "Patterns",
      activity_trends: "Trend",
      notable_shifts: "Shifts"
    });

    // C. Expertise (Formatted text)
    const exp = ai.interests_and_expertise || {};
    const expHtml = `
      <div><strong>Core Domains:</strong> ${exp.core_domains || "N/A"}</div>
      <div style="margin-top:5px;"><strong>Specialized Knowledge:</strong> ${exp.specialized_knowledge || "N/A"}</div>
      <div style="margin-top:5px;"><strong>Recurring Topics:</strong> ${exp.recurring_topics || "N/A"}</div>
    `;
    document.getElementById('expertise-box').innerHTML = expHtml;

    // D. Psych Profile (HTML)
    document.getElementById('psych-profile').innerHTML = ai.psychological_profile || "Profile generation failed.";

  });
});

// Helper to set text safely
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text || "N/A";
}

// Helper to create "Title: Value" lists inside modules
function fillModule(containerId, dataObj, labelMap) {
  const container = document.getElementById(containerId);
  if (!dataObj) {
    container.innerText = "N/A";
    return;
  }
  
  let html = "";
  for (const [key, label] of Object.entries(labelMap)) {
    const val = dataObj[key] || "N/A";
    html += `<div><strong>${label}:</strong> ${val}</div>`;
  }
  container.innerHTML = html;
}