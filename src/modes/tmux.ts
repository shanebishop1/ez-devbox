export interface PersistentTmuxCommandOptions {
  socketName: string;
  sessionName: string;
  command: string;
  detachBehavior?: "ctrl-c" | "tmux-default";
}

export function buildPersistentTmuxCommand(options: PersistentTmuxCommandOptions): string {
  const parts = [
    `tmux -u -L ${options.socketName}`,
    `new-session -A -s ${options.sessionName} "${options.command}"`,
    "\\; set-option -s escape-time 0",
    '\\; set-option -g default-terminal "screen-256color"',
    '\\; set-option -ga terminal-overrides ",xterm-256color:Tc,screen-256color:Tc,tmux-256color:Tc"',
    "\\; set-option -g status off",
  ];

  if (options.detachBehavior === "ctrl-c") {
    parts.push("\\; bind-key -n C-c detach-client");
  }

  return parts.join(" ");
}
