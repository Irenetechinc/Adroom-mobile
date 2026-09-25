browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrapeProfile") {
    const data = scrapeData();
    sendResponse(data);
  }
});

function scrapeData() {
  // 1. Get Username
  const urlParts = window.location.pathname.split('/');
  // usually /user/username/
  const username = urlParts[2] || "Unknown Subject";

  // 2. Get Description (Bio)
  // Try specific testids for new reddit, fall back to meta tags
  let description = "No description available.";
  const descEl = document.querySelector('[data-testid="profile-description"]');
  if (descEl) {
    description = descEl.innerText;
  } else {
    // Fallback for older layouts
    const metaDesc = document.querySelector('meta[property="og:description"]');
    if (metaDesc) description = metaDesc.content;
  }

  // 3. Get Profile Picture
  let avatarUrl = "";
  // Look for the specific avatar image in the sidebar
  const imgEl = document.querySelector('img[alt*="avatar"]');
  if (imgEl) {
    avatarUrl = imgEl.src;
  } else {
    // Fallback generic finder
    const profileImg = document.querySelector('div[class*="UserIcon"] img');
    if (profileImg) avatarUrl = profileImg.src;
  }

  // 4. Get Last Comment
  // This is tricky because the feed mixes posts and comments
  let lastComment = "No recent commentary intercepted.";
  
  // Attempt to find the first text block in the feed
  // "shreddit-comment" is used in the very newest UI
  const shredditComment = document.querySelector('shreddit-comment');
  if (shredditComment) {
    // It's usually inside a slot or shadow DOM, but innerText often catches it
    lastComment = shredditComment.getAttribute('body') || shredditComment.innerText;
  } else {
    // Standard new reddit div structure
    const commentBody = document.querySelector('div[data-testid="comment"] div[data-testid="elm-context-root"]');
    if (commentBody) {
        lastComment = commentBody.innerText;
    } else {
        // Fallback: First paragraph in the first post container
        const genericP = document.querySelector('.Post p, [data-testid="post-container"] p');
        if (genericP) lastComment = genericP.innerText;
    }
  }

  return {
    username: username,
    description: description,
    avatar: avatarUrl,
    lastComment: lastComment,
    date: new Date().toLocaleString()
  };
}