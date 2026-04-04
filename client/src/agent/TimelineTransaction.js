
import { VideoEditorTools } from './VideoEditorTools.js';

/**
 * TimelineTransaction
 * Wraps VideoEditorTools to support "Preview" and "Commit" workflows.
 * For MVP, it just executes directly since our Store has History (Undo).
 * In future, it can apply "Temporary Overlays" or "Ghost Clips".
 */
export class TimelineTransaction {
    constructor() {
        this.tools = new VideoEditorTools();
    }

    async executeBatch(actions) {
        console.log("⚡ Transaction: Executing Batch", actions);
        const results = [];
        const issues = []; // Collect validation issues

        for (const action of actions) {
            try {
                const res = await this.tools.execute(action); // Stores to history automatically
                results.push({ action: action.name, status: 'success', result: res });
            } catch (err) {
                console.error(`❌ Transaction Action Failed: ${action.name}`, err);
                results.push({ action: action.name, status: 'error', error: err.message });
            }
        }

        // Return structured result similar to AgentOrchestrator
        return {
            success: true, // Even if partial failure, we return results
            results,
            issues
        };
    }

    // Future: 
    // preview(action) -> Apply to a "Preview Layer"
    // commit() -> Merge Preview Layer to Main Track
    // discard() -> Clear Preview Layer
}
