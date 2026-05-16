// twitter.com/intent/tweet is Twitter's canonical intent URL format — fixed public API, not env-specific.
declare const shareText: string;
declare const shareUrl: string;
const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
