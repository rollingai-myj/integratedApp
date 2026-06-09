export const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
export const isWeChat = /MicroMessenger/i.test(ua);
export const isFeishu = /Lark|Feishu/i.test(ua);
export const isInAppWebView = isWeChat || isFeishu;
export const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
