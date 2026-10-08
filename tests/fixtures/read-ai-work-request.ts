// Entirely fictional company/contact request for offline regression tests; not a live contact lookup.
export const readAiRequest = {
  original: 'create a ticket for northstar events for morgan lee; look into Read.ai who is using it if that information is available and send that info to morgan - main goal here is to control the automated addition of read ai into all users meeting',
  verifiedContext: {company:'Example Northstar Community Events Authority',contact:'Morgan Lee',email:'morgan.lee@example.test'},
  title: 'Investigate Read.ai usage and control automatic meeting attendance',
  description: `Primary goal:
Control automatic Read.ai attendance in Example Northstar Community Events Authority users' meetings.

Requested work:
1. Investigate who is using Read.ai where authorized records and settings provide that information. Distinguish confirmed usage from app consent or invitations alone.
2. Identify the source of automatic meeting attendance where possible and the available user, workspace or organization controls, including limitations.
3. Send Morgan Lee the available findings, visibility gaps and recommended control approach.
4. Confirm the desired policy with Morgan before coordinating configuration changes and validating the agreed meeting behavior.

Completion criteria:
Morgan receives the available findings with visibility gaps identified. Document the source of automatic attendance where possible, the agreed control approach and validation outcome.

Unavailable usage data does not prove that nobody is using Read.ai. An organization-wide ban has not been requested.`
};
