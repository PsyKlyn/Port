// Write-up catalogue used by both the homepage and the single Write-ups page.
// Published entries are merged from localStorage at runtime.
const WRITEUPS = [
  {
    title: "TryHackMe — Your First Write-up",
    category: "TEMPLATE",
    date: "2026-09-30",
    excerpt: "Replace this card with your first real CTF or security-lab write-up.",
    tags: ["template"],
    url: "Write-Ups/example.html"
  },
  {
    title: "SQL Injection",
    category: "TRYHACKME",
    date: "2026-09-29",
    excerpt: "A security investigation covering request analysis, input handling and controlled SQL injection validation.",
    tags: ["sql"],
    url: "Write-Ups/sql-injection.html"
  },
  {
    title: "IDOR in User Profile Endpoint",
    category: "TRYHACKME",
    date: "2026-09-29",
    excerpt: "Documenting an object-level authorization issue discovered during an authorized security assessment.",
    tags: ["idor"],
    url: "Write-Ups/idor-in-user-profile-endpoint.html"
  }
];
