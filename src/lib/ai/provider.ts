export interface AISummaryRequest {
  userName: string;
  repositoriesChanged: number;
  attentionItems: {
    repoName: string;
    type: string;
    severity: string;
    title: string;
    description: string;
  }[];
}

export interface AIExplanationRequest {
  repoName: string;
  healthScore: number;
  ciScore: number;
  prScore: number;
  issueScore: number;
  activityScore: number;
  reasons: string[];
}

/**
 * Deterministic template fallback when AI is disabled or fails.
 */
export function getDeterministicDailyBriefSummary(req: AISummaryRequest): string {
  const attentionCount = req.attentionItems.length;
  if (attentionCount === 0) {
    return `Good morning, ${req.userName}. I checked your repositories. Today, ${req.repositoriesChanged} repositories changed. Everything else is in stable health. You have no pending items requiring attention.`;
  }
  
  const highlights = req.attentionItems
    .slice(0, 3)
    .map((item) => `${item.title} on ${item.repoName}`)
    .join(', ');
    
  return `Good morning, ${req.userName}. Today, ${req.repositoriesChanged} repositories changed. You have ${attentionCount} item${attentionCount > 1 ? 's' : ''} requiring attention. Main highlights include: ${highlights}.`;
}

/**
 * Deterministic template fallback when AI is disabled or fails.
 */
export function getDeterministicHealthExplanation(req: AIExplanationRequest): string {
  if (req.reasons.length === 0) {
    return `${req.repoName} is in perfect health (100/100) with successful CI runs and active pull request reviews.`;
  }
  return `${req.repoName} has a health score of ${req.healthScore}/100. Deductions are mainly due to: ${req.reasons.join('; ')}.`;
}

/**
 * Standard fetch to Gemini API.
 */
async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: 250,
        temperature: 0.2,
      }
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API returned status ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API returned an empty completion response.');
  }

  return text.trim();
}

/**
 * Standard fetch to OpenAI API.
 */
async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const url = 'https://api.openai.com/v1/chat/completions';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are RepoButler, a concise personal developer assistant. Do not invent repositories, issues, or numbers not supplied by the user.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 250,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API returned status ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI API returned an empty completion response.');
  }

  return text.trim();
}

/**
 * Generates a natural-language brief summary using the active AI provider, falling back to template text on failures.
 */
export async function generateDailyBriefSummary(req: AISummaryRequest): Promise<string> {
  const provider = process.env.AI_PROVIDER;
  const apiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

  if (!provider || provider === 'none' || !apiKey) {
    console.log('AI provider is not configured. Falling back to deterministic template.');
    return getDeterministicDailyBriefSummary(req);
  }

  const prompt = `
You are RepoButler, a calm personal developer assistant.
Generate a concise, 2-3 sentence overview of today's GitHub activity briefing for developer ${req.userName}.

Here is the structured repository data:
- Repositories changed: ${req.repositoriesChanged}
- Attention items: ${req.attentionItems.length}
${req.attentionItems.map((item, idx) => `- Item ${idx + 1} (${item.severity}): ${item.title} on ${item.repoName}. Description: ${item.description}`).join('\n')}

Rules:
1. Ground your summary strictly in the provided data.
2. DO NOT invent repository names, commit counts, issues, or recommendations.
3. Be professional and calm. Do not shame the user.
4. Keep the output under 80 words.
  `;

  try {
    if (provider === 'gemini') {
      return await callGemini(prompt, apiKey);
    } else if (provider === 'openai') {
      return await callOpenAI(prompt, apiKey);
    } else {
      console.warn(`Unknown AI provider "${provider}". Falling back to template.`);
      return getDeterministicDailyBriefSummary(req);
    }
  } catch (error) {
    console.error(`AI generation failed for daily brief. Falling back to template. Error:`, error);
    return getDeterministicDailyBriefSummary(req);
  }
}

/**
 * Generates an actionable health explanation using the active AI provider, falling back on failures.
 */
export async function explainHealthScore(req: AIExplanationRequest): Promise<string> {
  const provider = process.env.AI_PROVIDER;
  const apiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

  if (!provider || provider === 'none' || !apiKey) {
    return getDeterministicHealthExplanation(req);
  }

  const prompt = `
You are RepoButler, a calm personal developer assistant.
Generate a concise 1-2 sentence explanation of why the health score for "${req.repoName}" is currently ${req.healthScore}/100.

Context:
- CI Reliability score: ${req.ciScore}%
- Pull Request Health score: ${req.prScore}%
- Issue Health score: ${req.issueScore}%
- Activity score: ${req.activityScore}%
- Key deduction reasons: ${req.reasons.join(', ')}

Rules:
1. Explain the score objectively based only on the context reasons.
2. Highlight the main reason for point deductions.
3. DO NOT invent reasons or metrics.
4. Output must be under 50 words.
  `;

  try {
    if (provider === 'gemini') {
      return await callGemini(prompt, apiKey);
    } else if (provider === 'openai') {
      return await callOpenAI(prompt, apiKey);
    } else {
      return getDeterministicHealthExplanation(req);
    }
  } catch (error) {
    console.error(`AI generation failed for health explanation. Falling back to template. Error:`, error);
    return getDeterministicHealthExplanation(req);
  }
}
