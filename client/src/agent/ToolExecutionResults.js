/** A tool must explicitly confirm success before ROKA reports it as verified. */
export function getToolExecutionStatus(result) {
    if (result?.success === true) return 'success';
    if (result?.success === false) return 'error';
    return 'unverified';
}

export function summarizeToolExecutionResults(results = []) {
    const allVerified = results.length > 0 && results.every(item => item.status === 'success');
    const failedActions = results.filter(item => item.status !== 'success');
    return {
        success: allVerified,
        failedActions,
        message: allVerified
            ? 'Every planned action reported verified success.'
            : `${failedActions.length} of ${results.length} planned action(s) failed or could not be verified.`,
    };
}
