import {
  BarChart3,
  BookOpen,
  Crosshair,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface Capability {
  key: string;
  label: string;
  icon: LucideIcon;
  prompts: Array<{ title: string; description: string; content: string }>;
}

export const capabilities: Capability[] = [
  {
    key: "visibility",
    label: "Visibility",
    icon: BarChart3,
    prompts: [
      {
        title: "Explain my visibility",
        description: "Summarize performance across answer engines",
        content:
          "Explain my current AI visibility and the most important changes.",
      },
      {
        title: "Find the biggest gap",
        description: "Identify where competitors are ahead",
        content:
          "Where is my biggest visibility gap compared with competitors?",
      },
      {
        title: "Compare surfaces",
        description: "See how answer engines differ",
        content: "Compare my performance across tracked AI answer surfaces.",
      },
      {
        title: "Create an action plan",
        description: "Turn the data into next steps",
        content:
          "Create a prioritized action plan to improve my AI visibility.",
      },
    ],
  },
  {
    key: "prompts",
    label: "Prompts",
    icon: Sparkles,
    prompts: [
      {
        title: "Find prompt gaps",
        description: "Discover buyer questions worth tracking",
        content: "Suggest important buyer prompts that I am not tracking yet.",
      },
      {
        title: "Improve my prompts",
        description: "Review coverage and specificity",
        content:
          "Audit my tracked prompts and tell me which ones need improvement.",
      },
      {
        title: "Create comparison prompts",
        description: "Track high-intent competitive questions",
        content:
          "Create high-intent comparison prompts for my brand and competitors.",
      },
      {
        title: "Build a prompt set",
        description: "Cover the buyer journey",
        content:
          "Create and track a balanced prompt set across the buyer journey.",
      },
    ],
  },
  {
    key: "citations",
    label: "Citations",
    icon: Search,
    prompts: [
      {
        title: "Prioritize citations",
        description: "Find sources with the most leverage",
        content: "Which citations should I improve first, and why?",
      },
      {
        title: "Find source gaps",
        description: "See where competitors earn authority",
        content:
          "Where are competitors being cited from sources that do not mention me?",
      },
      {
        title: "Review my domains",
        description: "Understand owned-source coverage",
        content:
          "How often are my owned domains cited, and where are the gaps?",
      },
      {
        title: "Plan content outreach",
        description: "Turn evidence into targets",
        content:
          "Create a prioritized content and outreach plan from my citation data.",
      },
    ],
  },
  {
    key: "research",
    label: "Research",
    icon: BookOpen,
    prompts: [
      {
        title: "Research my market",
        description: "Connect current web context to tracked data",
        content:
          "Research the current market around my brand and connect it to my visibility data.",
      },
      {
        title: "Analyze competitors",
        description: "Explain who is winning and why",
        content:
          "Analyze my competitors and explain who is winning AI visibility and why.",
      },
      {
        title: "Find emerging themes",
        description: "Spot new topics and buyer language",
        content: "What emerging themes should I add to my AEO strategy?",
      },
      {
        title: "Recommend positioning",
        description: "Find a defensible angle",
        content:
          "Based on my project and current web research, recommend a stronger positioning angle.",
      },
    ],
  },
];

export const defaultPrompts = capabilities[0].prompts;
export const TargetIcon = Crosshair;
