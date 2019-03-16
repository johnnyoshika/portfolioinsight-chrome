chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([{
      conditions: [new chrome.declarativeContent.PageStateMatcher({
        pageUrl: { urlMatches: 'https:\/\/www\.scotiaonline\.scotiabank\.com\/online\/views\/accounts\/accountDetails\/.+' }
      })],
      actions: [new chrome.declarativeContent.ShowPageAction()]
    }]);
  });
});