// Provider base URLs. Overridable so tests and local stubs can stand in for the real services.
export const endpoints={
 polar:()=>process.env.POLAR_API_BASE||'https://sandbox-api.polar.sh',
 metaGraph:()=>process.env.META_GRAPH_BASE||`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION||'v23.0'}`,
 telegram:()=>process.env.TELEGRAM_API_BASE||'https://api.telegram.org',
 googleToken:()=>process.env.GOOGLE_TOKEN_URL||'https://oauth2.googleapis.com/token',
 googleCalendar:()=>process.env.GOOGLE_CALENDAR_BASE||'https://www.googleapis.com/calendar/v3'
};
