export const folioTemplates = [
  {
    id: "procedure",
    title: "Procedure",
    markdown:
      "## Purpose\nDescribe what this procedure accomplishes.\n\n## Before you begin\n- Access and prerequisites\n\n## Steps\n1. First step\n2. Next step\n\n## Verify the result\n\n## Recovery\n",
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting guide",
    markdown:
      "## Symptoms\n\n## Checks\n- [ ] Confirm the issue\n\n## Resolution\n\n## Escalation\n",
  },
  {
    id: "contact",
    title: "Contact",
    markdown:
      "## Contact details\n| Field | Details |\n| --- | --- |\n| Name | |\n| Role | |\n| Team / organization | |\n| Phone | |\n| Email | |\n| Availability / time zone | |\n\n## Responsibilities\n\n## Related notes\nType @ to link another note.\n",
  },
  {
    id: "directory",
    title: "Contact directory",
    markdown:
      "## Contacts\n| Name | Role / team | Phone | Email | Contact note |\n| --- | --- | --- | --- | --- |\n| | | | | |\n| | | | | |\n\nUse @ in the contact-note column to link a person’s page.\n",
  },
  {
    id: "oncall",
    title: "On-call list",
    markdown:
      "## Coverage\nService / team:\nCoverage dates and time zone:\n\n| Service | Primary | Backup | Phone / email | Coverage |\n| --- | --- | --- | --- | --- |\n| | | | | |\n\n## Escalation\n1. Contact the primary.\n2. Contact the backup.\n\n## Related procedures\n",
  },
  {
    id: "meeting",
    title: "Meeting notes",
    markdown:
      "## Meeting\nDate:\nAttendees:\n\n## Agenda\n\n## Notes\n\n## Decisions\n\n## Actions\n- [ ] Action\n",
  },
  {
    id: "decision",
    title: "Decision record",
    markdown:
      "## Context\n\n## Decision\n\n## Alternatives considered\n\n## Consequences\n\n## References\n",
  },
  {
    id: "incident",
    title: "Incident summary",
    markdown:
      "## Summary\n\n## Impact\n\n## Timeline\n| Time | Event |\n| --- | --- |\n| | |\n\n## Resolution\n\n## Follow-up\n- [ ] Action\n",
  },
] as const;
