const asyncHandler = require('express-async-handler');
const {
  sanitizeUserInput,
  sanitizeAndDemarcateContent,
  buildSystemInstruction,
  AI_TOOLS,
  executeToolCall,
  confirmAndExecuteAction,
} = require('../services/aiSecurityService');
const { ROLE_HIERARCHY } = require('../middleware/auth');

// @desc    Process AI chat query, sanitize untrusted context, and securely execute tool calls
// @route   POST /api/ai/chat
// @access  Private
const processAiChat = asyncHandler(async (req, res) => {
  const { prompt, contextDocuments = [], toolCall } = req.body;

  if (!prompt || !prompt.trim()) {
    res.status(400);
    throw new Error('Prompt is required');
  }

  // 1. Build immutable system instruction enforcing data-instruction separation
  const systemInstruction = buildSystemInstruction({ user: req.user });

  // 2. Treat user input as untrusted data
  const sanitizedUserPrompt = sanitizeUserInput(prompt);

  // 3. Treat all retrieved documents/external content as untrusted data
  const demarcatedDocuments = (Array.isArray(contextDocuments) ? contextDocuments : []).map((doc, idx) =>
    sanitizeAndDemarcateContent(doc.content || doc, {
      source: doc.source || `retrieved_doc_${idx + 1}`,
      docId: doc.id || doc._id || null,
    })
  );

  // 4. If AI tool execution is requested
  let toolExecutionResult = null;
  if (toolCall && toolCall.name) {
    toolExecutionResult = await executeToolCall({
      toolName: toolCall.name,
      parameters: toolCall.parameters || {},
      user: req.user,
    });
  }

  res.json({
    success: true,
    systemInstruction,
    sanitizedPrompt: sanitizedUserPrompt,
    demarcatedContext: demarcatedDocuments,
    toolExecution: toolExecutionResult,
    message: toolExecutionResult?.requiresConfirmation
      ? 'Tool execution paused: Sensitive operation requires explicit confirmation.'
      : 'Query processed successfully under least-privilege security controls.',
  });
});

// @desc    Explicitly confirm and execute a sensitive AI tool action
// @route   POST /api/ai/confirm-action
// @access  Private
const confirmAction = asyncHandler(async (req, res) => {
  const { confirmationToken, actionId } = req.body;

  if (!confirmationToken && !actionId) {
    res.status(400);
    throw new Error('Confirmation token or action ID is required');
  }

  const result = await confirmAndExecuteAction({
    confirmationToken,
    actionId,
    user: req.user,
  });

  res.json({
    success: true,
    message: 'Sensitive operation confirmed and executed successfully.',
    action: result,
  });
});

// @desc    Analyze retrieved external document with untrusted data isolation
// @route   POST /api/ai/analyze-document
// @access  Private
const analyzeDocument = asyncHandler(async (req, res) => {
  const { documentText, source = 'external_document', docId } = req.body;

  if (!documentText) {
    res.status(400);
    throw new Error('documentText is required');
  }

  // Demarcate and neutralize prompt injection attempts
  const safeDemarcated = sanitizeAndDemarcateContent(documentText, { source, docId });

  res.json({
    success: true,
    isolatedContent: safeDemarcated,
    securityNotice: 'Content has been isolated in <untrusted_document> tags. System instructions strictly forbid prompt overrides.',
  });
});

// @desc    List available AI tools filtered by caller's role (Least Privilege)
// @route   GET /api/ai/tools
// @access  Private
const getAvailableTools = asyncHandler(async (req, res) => {
  const callerRole = (req.user?.role || 'member').toLowerCase();
  const callerLevel = ROLE_HIERARCHY[callerRole] || 1;

  const accessibleTools = Object.values(AI_TOOLS)
    .filter((tool) => {
      const requiredLevel = ROLE_HIERARCHY[tool.requiredRole] || 1;
      return callerLevel >= requiredLevel;
    })
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      requiredRole: tool.requiredRole,
      sensitive: tool.sensitive,
      schema: tool.schema,
    }));

  res.json({
    success: true,
    callerRole,
    count: accessibleTools.length,
    tools: accessibleTools,
  });
});

module.exports = {
  processAiChat,
  confirmAction,
  analyzeDocument,
  getAvailableTools,
};
