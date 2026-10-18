// Provider base URLs. Overridable so tests and local stubs can stand in for the real services.
export const endpoints={
 twilio:()=>process.env.TWILIO_API_BASE||'https://api.twilio.com',
 stripe:()=>process.env.STRIPE_API_BASE||'https://api.stripe.com',
 metaGraph:()=>process.env.META_GRAPH_BASE||`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION||'v23.0'}`,
 telegram:()=>process.env.TELEGRAM_API_BASE||'https://api.telegram.org',
 googleToken:()=>process.env.GOOGLE_TOKEN_URL||'https://oauth2.googleapis.com/token',
 googleCalendar:()=>process.env.GOOGLE_CALENDAR_BASE||'https://www.googleapis.com/calendar/v3'
};
