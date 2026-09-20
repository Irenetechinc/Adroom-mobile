module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';

  return {
    ...config,
    name: config.name || 'Adirum AI',
    slug: config.slug || 'adroom-mobile',
    extra: {
      ...config.extra,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      facebookAppId: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID,
    },
    android: {
      ...config.android,
      googleServicesFile,
    },
  };
};
