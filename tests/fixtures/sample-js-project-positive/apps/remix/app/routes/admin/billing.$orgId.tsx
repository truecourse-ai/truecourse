// dashboard.stripe.com is the canonical Stripe domain — not environment-configurable.
declare const org: { stripeCustomerId: string };
const stripeCustomerLink = `https://dashboard.stripe.com/customers/${org.stripeCustomerId}`;
const stripeSubscriptionLink = `https://dashboard.stripe.com/subscriptions`;


// Stripe dashboard URL shown as text in admin UI — canonical domain, not a runtime endpoint.
declare const orgStripeId: string;
const stripeUrl = `https://dashboard.stripe.com/customers/${orgStripeId}`;
const linkLabel = stripeUrl; // display URL as text label in admin table


// dashboard.stripe.com — canonical Stripe domain, not configurable; admin UI deep-links are correct.
declare const billingOrg: { stripeCustomerId: string; stripeSubscriptionId: string };
const stripeCustomerUrl = `https://dashboard.stripe.com/customers/${billingOrg.stripeCustomerId}`;
const stripeSubUrl = `https://dashboard.stripe.com/subscriptions/${billingOrg.stripeSubscriptionId}`;
