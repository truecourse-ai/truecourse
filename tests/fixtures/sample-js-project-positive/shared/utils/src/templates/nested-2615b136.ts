// FP shape 2615b136 mode: ternary-conditional-url-segment
// Inner template literal is wrapped in a ternary — idiomatic conditional URL segment.
// Visitor should NOT flag because the nesting is gated by a conditional branch,
// not a free-standing nested template like the negative TP.
declare const tenantId: string;
declare const isAdmin: boolean;
export const profileUrl_2615b136 = `https://example.com/${isAdmin ? `admin/${tenantId}/settings` : `user/${tenantId}/dashboard`}/profile`;
