// 'https://chatgpt.com' is the canonical URL for the ChatGPT web app — fixed third-party domain.
declare const pageContent: string;
declare const pageTitle: string;
const chatGptUrl = `https://chatgpt.com/?q=${encodeURIComponent(`Explain this: ${pageTitle}\n\n${pageContent.slice(0, 500)}`)}`;


// 'https://claude.ai' is Anthropic's canonical URL — fixed third-party domain, deep-link to external AI service.
declare const docContent: string;
declare const docTitle: string;
const claudeAiUrl = `https://claude.ai/new?q=${encodeURIComponent(`Explain: ${docTitle}\n\n${docContent.slice(0, 400)}`)}`;
