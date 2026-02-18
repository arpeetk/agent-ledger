const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const BLUE = '\x1b[34m';
const WHITE = '\x1b[37m';
const BG_BLUE = '\x1b[44m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';
const BG_RED = '\x1b[41m';

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export function banner(): void {
  console.log();
  console.log(`${BOLD}${CYAN}┌─────────────────────────────────────────────────────────────┐${RESET}`);
  console.log(`${BOLD}${CYAN}│                                                             │${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}    ${BOLD}${WHITE}Claude AI Research Assistant${RESET}                              ${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}    ${DIM}Powered by Agent Ledger — policy-gated tool execution${RESET}     ${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│                                                             │${RESET}`);
  console.log(`${BOLD}${CYAN}└─────────────────────────────────────────────────────────────┘${RESET}`);
  console.log();
}

export function thinking(message: string): void {
  console.log(`  ${DIM}${timestamp()}${RESET}  ${MAGENTA}[thinking]${RESET} ${DIM}${message}${RESET}`);
}

export function action(toolName: string, intent: string): void {
  console.log(`  ${DIM}${timestamp()}${RESET}  ${BLUE}[action]${RESET}   ${BOLD}${toolName}${RESET} — ${intent}`);
}

export function allowed(receiptId: string): void {
  console.log(`  ${DIM}${timestamp()}${RESET}  ${BG_GREEN}${WHITE}${BOLD} ALLOWED ${RESET} ${GREEN}Receipt: ${receiptId}${RESET}`);
}

export function denied(reason: string): void {
  console.log(`  ${DIM}${timestamp()}${RESET}  ${BG_RED}${WHITE}${BOLD} DENIED ${RESET}  ${RED}${reason}${RESET}`);
}

export function pendingApproval(url: string): void {
  console.log(`  ${DIM}${timestamp()}${RESET}  ${BG_YELLOW}${WHITE}${BOLD} PENDING ${RESET} ${YELLOW}Awaiting human approval...${RESET}`);
  console.log(`  ${DIM}${' '.repeat(10)}${RESET}           ${DIM}Approve at: ${CYAN}${url}${RESET}`);
}

export function approved(receiptId: string): void {
  console.log(`  ${DIM}${timestamp()}${RESET}  ${BG_GREEN}${WHITE}${BOLD} APPROVED ${RESET} ${GREEN}Human approved — executed. Receipt: ${receiptId}${RESET}`);
}

export function step(num: number, total: number, title: string): void {
  console.log();
  console.log(`  ${BOLD}${CYAN}━━━ Step ${num}/${total}: ${title} ━━━${RESET}`);
  console.log();
}

export function separator(): void {
  console.log(`  ${DIM}${'─'.repeat(60)}${RESET}`);
}

export function info(message: string): void {
  console.log(`  ${DIM}${timestamp()}${RESET}  ${DIM}${message}${RESET}`);
}

export function summary(stats: { allowed: number; denied: number; pending: number; total: number }): void {
  console.log();
  console.log(`${BOLD}${CYAN}┌─────────────────────────────────────────────────────────────┐${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}  ${BOLD}Session Summary${RESET}                                           ${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}                                                             ${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}  Total tool calls:  ${BOLD}${stats.total}${RESET}${' '.repeat(40 - String(stats.total).length)}${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}  Auto-allowed:      ${GREEN}${stats.allowed}${RESET}${' '.repeat(40 - String(stats.allowed).length)}${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}  Needed approval:   ${YELLOW}${stats.pending}${RESET}${' '.repeat(40 - String(stats.pending).length)}${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}  Denied by policy:  ${RED}${stats.denied}${RESET}${' '.repeat(40 - String(stats.denied).length)}${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}                                                             ${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}  ${DIM}Every action recorded as a signed, tamper-evident receipt.${RESET}  ${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}  ${DIM}View the full audit trail: ${CYAN}http://localhost:3000${RESET}           ${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}│${RESET}                                                             ${BOLD}${CYAN}│${RESET}`);
  console.log(`${BOLD}${CYAN}└─────────────────────────────────────────────────────────────┘${RESET}`);
  console.log();
}
