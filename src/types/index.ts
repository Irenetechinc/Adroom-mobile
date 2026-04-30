
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
  };
  ConnectedAccounts: undefined;
  Subscription: { scrollToPlan?: string; tab?: string } | undefined;
  PrivacySecurity: undefined;
  Notifications: undefined;
  About: undefined;
  
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
