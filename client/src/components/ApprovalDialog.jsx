/**
 * ApprovalDialog - Event-Driven Approval UI Component
 * 
 * Renders a modal dialog when approval is required.
 * Triggered by APPROVAL_REQUIRED events - NEVER POLLS.
 */

import React from 'react';
import { useApprovalDialog } from '../hooks/useApprovalDialog.js';
import { AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react';

/**
 * Approval Dialog Component
 * Displays when user approval is required for a job
 */
export function ApprovalDialog() {
    const {
        isOpen,
        approval,
        isProcessing,
        queueLength,
        approve,
        deny,
        title,
        description,
        actions,
        reasons,
        jobId
    } = useApprovalDialog();

    if (!isOpen) return null;

    return (
        <div className="approval-dialog-overlay">
            <div className="approval-dialog">
                {/* Header */}
                <div className="approval-dialog-header">
                    <AlertTriangle className="approval-icon" size={24} />
                    <h2>{title}</h2>
                </div>

                {/* Content */}
                <div className="approval-dialog-content">
                    <p className="approval-description">{description}</p>

                    {/* Reasons */}
                    {reasons.length > 0 && (
                        <div className="approval-reasons">
                            <h4>Why this needs approval:</h4>
                            <ul>
                                {reasons.map((reason, i) => (
                                    <li key={i}>
                                        {typeof reason === 'string' ? reason : reason.message}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Actions being approved */}
                    {actions && (
                        <div className="approval-actions-preview">
                            <h4>Actions to be performed:</h4>
                            <code>{actions}</code>
                        </div>
                    )}

                    {/* Job ID */}
                    <p className="approval-job-id">Job: {jobId}</p>

                    {/* Queue indicator */}
                    {queueLength > 0 && (
                        <p className="approval-queue">
                            <Clock size={14} />
                            {queueLength} more approval{queueLength > 1 ? 's' : ''} pending
                        </p>
                    )}
                </div>

                {/* Actions */}
                <div className="approval-dialog-actions">
                    <button
                        className="approval-btn deny"
                        onClick={() => deny('User denied')}
                        disabled={isProcessing}
                    >
                        <XCircle size={18} />
                        Deny
                    </button>
                    <button
                        className="approval-btn approve"
                        onClick={approve}
                        disabled={isProcessing}
                    >
                        <CheckCircle size={18} />
                        Approve
                    </button>
                </div>
            </div>

            <style>{`
                .approval-dialog-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    animation: fadeIn 0.2s ease-out;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                
                .approval-dialog {
                    background: linear-gradient(145deg, #1e1e2e, #2a2a3e);
                    border: 1px solid rgba(255, 200, 50, 0.3);
                    border-radius: 16px;
                    width: 90%;
                    max-width: 480px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5),
                                0 0 30px rgba(255, 200, 50, 0.1);
                    animation: slideUp 0.3s ease-out;
                }
                
                @keyframes slideUp {
                    from {
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                
                .approval-dialog-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 20px 24px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                }
                
                .approval-dialog-header h2 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 600;
                    color: #fff;
                }
                
                .approval-icon {
                    color: #ffc832;
                }
                
                .approval-dialog-content {
                    padding: 20px 24px;
                }
                
                .approval-description {
                    color: rgba(255, 255, 255, 0.8);
                    margin: 0 0 16px 0;
                    line-height: 1.5;
                }
                
                .approval-reasons {
                    background: rgba(255, 200, 50, 0.1);
                    border-radius: 8px;
                    padding: 12px 16px;
                    margin-bottom: 16px;
                }
                
                .approval-reasons h4 {
                    margin: 0 0 8px 0;
                    font-size: 13px;
                    font-weight: 600;
                    color: #ffc832;
                }
                
                .approval-reasons ul {
                    margin: 0;
                    padding-left: 20px;
                }
                
                .approval-reasons li {
                    color: rgba(255, 255, 255, 0.7);
                    font-size: 13px;
                    margin-bottom: 4px;
                }
                
                .approval-actions-preview {
                    margin-bottom: 16px;
                }
                
                .approval-actions-preview h4 {
                    margin: 0 0 8px 0;
                    font-size: 13px;
                    font-weight: 600;
                    color: rgba(255, 255, 255, 0.6);
                }
                
                .approval-actions-preview code {
                    display: block;
                    background: rgba(0, 0, 0, 0.3);
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 12px;
                    color: #82d8ff;
                }
                
                .approval-job-id {
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.4);
                    margin: 12px 0 0 0;
                }
                
                .approval-queue {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.5);
                    margin-top: 8px;
                }
                
                .approval-dialog-actions {
                    display: flex;
                    gap: 12px;
                    padding: 16px 24px 20px;
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                }
                
                .approval-btn {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 12px 20px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                
                .approval-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                
                .approval-btn.deny {
                    background: rgba(255, 80, 80, 0.2);
                    color: #ff6b6b;
                    border: 1px solid rgba(255, 80, 80, 0.3);
                }
                
                .approval-btn.deny:hover:not(:disabled) {
                    background: rgba(255, 80, 80, 0.3);
                }
                
                .approval-btn.approve {
                    background: linear-gradient(135deg, #4ade80, #22c55e);
                    color: #fff;
                }
                
                .approval-btn.approve:hover:not(:disabled) {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(74, 222, 128, 0.3);
                }
            `}</style>
        </div>
    );
}

export default ApprovalDialog;
