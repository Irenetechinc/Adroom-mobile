document.addEventListener('DOMContentLoaded', () => {
  const setupView = document.getElementById('setup-view');
  const mainView = document.getElementById('main-view');
  const errorView = document.getElementById('error-view');
  
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveKeyBtn = document.getElementById('saveKeyBtn');
  const generateBtn = document.getElementById('generateBtn');
  const resetKeyLink = document.getElementById('resetKey');
  
  const loadingSection = document.getElementById('loading-section');
  const statusText = loadingSection.querySelector('.status'); // To update text

  // 1. Check Key
  browser.storage.local.get('groq_key').then((data) => {
    if (data.groq_key) checkUrlAndShowMain();
    else showView(setupView);
  });

  // 2. Save Key
  saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      browser.storage.local.set({ 'groq_key': key }).then(() => checkUrlAndShowMain());
    }
  });

  // 3. Reset Key
  resetKeyLink.addEventListener('click', () => {
    browser.storage.local.remove('groq_key').then(() => {
      apiKeyInput.value = '';
      showView(setupView);
    });
  });

  // 4. GENERATE BUTTON (Updated Logic)
  generateBtn.addEventListener('click', () => {
    // A. Change UI to Loading
    generateBtn.classList.add('hidden');
    loadingSection.classList.remove('hidden');
    
    // B. Send Message and WAIT for response
    browser.runtime.sendMessage({ action: "startAnalysis" })
      .then((response) => {
        // This code runs ONLY when background.js calls sendResponse()
        
        if (response && response.status === "success") {
          // C. Update UI to Success
          statusText.textContent = "Report Generated!";
          statusText.style.color = "green";
          statusText.style.fontWeight = "bold";
          
          // D. Close Popup after 1 second so user sees the success message
          setTimeout(() => {
            window.close();
          }, 1000);
        } else {
          // Handle Error
          statusText.textContent = "Error: " + (response.message || "Unknown");
          statusText.style.color = "red";
        }
      })
      .catch((err) => {
        statusText.textContent = "Communication Error";
        console.error(err);
      });
  });

  function checkUrlAndShowMain() {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0].url.includes("reddit.com/user/")) {
        showView(mainView);
        generateBtn.classList.remove('hidden');
        loadingSection.classList.add('hidden');
        // Reset status text color just in case
        statusText.textContent = "Extracting Intelligence...";
        statusText.style.color = "#666"; 
        statusText.style.fontWeight = "normal";
      } else {
        showView(errorView);
      }
    });
  }

  function showView(viewElement) {
    setupView.classList.add('hidden');
    mainView.classList.add('hidden');
    errorView.classList.add('hidden');
    viewElement.classList.remove('hidden');
  }
});