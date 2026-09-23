import assert from 'assert';
import fs from 'fs';
import path from 'path';

const sourceRoot = path.resolve(__dirname);
const read = (relativePath: string) => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');

const agentBase = read('agents/agentBase.js');
const apmaActions = read('apma/apmaActionService.js');
const orchestrator = read('agents/agentOrchestrator.js');
const supervisor = read('services/agentSupervisor.js');
const coordinator = read('services/strategyCoordinator.js');
const graphicsDesigner = read('agents/graphicsDesignerAgent.js');
const smartVideoEditor = read('services/smartVideoEditor.js');

assert.ok(agentBase.includes('validateBeforePublish'), 'AgentBase must enforce critic validation');
assert.ok(agentBase.includes("operation: 'publish_to_platform'"), 'Platform publishing must be critic-gated');
assert.ok(agentBase.includes("operation: 'reply_to_comment'"), 'Comment replies must be critic-gated');
assert.ok(agentBase.includes("operation: 'send_direct_message'"), 'Direct messages must be critic-gated');
assert.ok(agentBase.includes("operation: 'quick_reply'"), 'Generated quick replies must be critic-gated');
assert.ok(apmaActions.includes("operation: 'apma_content_publish'"), 'APMA text publishing must be critic-gated');
assert.ok(apmaActions.includes("operation: 'apma_video_publish'"), 'APMA video publishing must be critic-gated');
assert.ok(!apmaActions.includes('criticAgentService.analyze'), 'APMA publishing must not rely on fire-and-forget review');
assert.ok(orchestrator.includes('agentEvolutionService'), 'Performance monitoring must record evolution outcomes');
assert.ok(supervisor.includes('agent_supervisor_runs'), 'Supervisor must persist loop observability');
assert.ok(coordinator.includes('strategy_coordination'), 'Active strategies must have a coordination loop');
assert.ok(coordinator.includes('conversationAgent.runForStrategy'), 'Coordinator must delegate conversation monitoring');
assert.ok(coordinator.includes('dataCollectionAgent.collectForStrategy'), 'Coordinator must delegate live evidence collection');
assert.ok(graphicsDesigner.includes('selectCreativeConcept'), 'Graphics must select a per-post creative concept');
assert.ok(graphicsDesigner.includes('creative_concept'), 'Graphics must persist the creative concept');
assert.ok(!graphicsDesigner.includes('hero, lifestyle, testimonial, countdown'), 'Graphics must not contain a fixed visual template catalog');
assert.ok(graphicsDesigner.includes('freshness'), 'Graphics must record intelligence freshness');
assert.ok(smartVideoEditor.includes('intelligenceFreshness'), 'Video decisions must persist intelligence freshness');

console.log('Agent framework contract checks passed.');