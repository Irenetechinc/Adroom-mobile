
export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  Signup: undefined;
  Main: undefined;
  // AgentChat moved to MainTab
  StrategyApproval: { strategy: any };
  AgentChat: { fromStrategyApproval?: boolean };
  ConnectedAccounts: undefined;
  
  // Strategy Creation Wizard
  StrategyWizard_ProductIntake: undefined;
  StrategyWizard_GoalSelection: undefined;
  StrategyWizard_DurationSelection: undefined;
  StrategyWizard_Comparison: undefined;
};

export type DrawerParamList = {
  AgentChat: { fromStrategyApproval?: boolean };
  Dashboard: undefined;
  CampaignList: undefined;
  Settings: undefined;
  ConnectedAccounts: undefined;
};

export type MainTabParamList = {
  AgentChat: { fromStrategyApproval?: boolean }; // New Home
  Dashboard: undefined;
  CampaignList: undefined;
  StrategyHistory: undefined;
  Wallet: undefined;
  Settings: undefined;
};
