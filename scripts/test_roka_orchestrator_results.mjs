import assert from 'node:assert/strict';
import { getToolExecutionStatus, summarizeToolExecutionResults } from '../client/src/agent/ToolExecutionResults.js';

assert.equal(getToolExecutionStatus({ success: true, verified: true }), 'success');
assert.equal(getToolExecutionStatus({ success: false, message: 'No target.' }), 'error');
assert.equal(getToolExecutionStatus({ message: 'No success flag.' }), 'unverified');

const verified = summarizeToolExecutionResults([
    { action: 'apply_motion_effect_stack', status: 'success' },
]);
assert.equal(verified.success, true);
assert.deepEqual(verified.failedActions, []);

const partial = summarizeToolExecutionResults([
    { action: 'design_scene', status: 'success' },
    { action: 'apply_motion_effect_stack', status: 'error' },
]);
assert.equal(partial.success, false);
assert.equal(partial.failedActions.length, 1);
assert.match(partial.message, /1 of 2/);

assert.equal(summarizeToolExecutionResults([]).success, false);

console.log('ROKA orchestrator result reporting passed.');
