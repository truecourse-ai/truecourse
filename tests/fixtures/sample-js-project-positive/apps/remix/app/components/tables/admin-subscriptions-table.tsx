// dashboard.stripe.com is the canonical, unchanging Stripe dashboard domain.
declare const subscription: { stripeCustomerId: string };
const stripeLink = `https://dashboard.stripe.com/customers/${subscription.stripeCustomerId}`;


// Same canonical Stripe dashboard domain — line 169 equivalent, admin deep-link.
declare const customer: { stripeId: string; name: string };
const stripePortalLink = `https://dashboard.stripe.com/customers/${customer.stripeId}/subscriptions`;
const displayText = `Manage ${customer.name} on Stripe: ${stripePortalLink}`;
