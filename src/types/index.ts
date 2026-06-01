
export type RootStackParamList = {
  Onboarding: undefined;
  Login: { prefillEmail?: string } | undefined;
  Signup: undefined;
  ResetPassword: undefined;
  Main: { screen?: keyof MainTabParamList } | undefined;
  // AgentChat moved to MainTab
  StrategyApproval: { strategy: any };
  AgentChat: { 
    fromStrategyApproval?: boolean; 
    connectFacebook?: boolean;
    connectInstagram?: boolean;
    connectTikTok?: boolean;
    connectLinkedIn?: boolean;
    connectTwitter?: boolean;
    connectWhatsApp?: boolean;
  };
  ConnectedAccounts: undefined;
  Subscription: { scrollToPlan?: string; tab?: string; autoStartTrial?: string } | undefined;
  Referral: undefined;
  PrivacySecurity: undefined;
  Notifications: undefined;
  About: undefined;
  Leads: undefined;
  LeadConversation: { lead: {
    id: string; platform: string; platform_username: string; platform_user_id: string;
    intent_score: number; stage: string; dm_sequence_step: number;
    first_interaction?: string; last_contacted_at?: string; next_followup_at?: string; created_at: string;
  }};
  
  // Strategy Creation Wizard
  StrategyWizard_ProductIntake: undefined;
  StrategyWizard_GoalSelection: undefined;
  StrategyWizard_DurationSelection: undefined;
  StrategyWizard_Comparison: undefined;

};

export type DrawerParamList = {
  AgentChat: { fromStrategyApproval?: boolean };
  Dashboard: undefined;
  Settings: undefined;
  ConnectedAccounts: undefined;
};

export type MainTabParamList = {
  AgentChat: { fromStrategyApproval?: boolean };
  Dashboard: undefined;
  StrategyHistory: undefined;
  Interactions: undefined;
  Community: undefined;
  Settings: undefined;
};
