import type { SVGProps } from "react";

export function StudioCreationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 19.5v-12l5-4 6 11 5-8v11L15 21 9 10l-5 9.5Z" />
      <path d="m4 7.5 5 2.5m6 4.5 5 3" />
    </svg>
  );
}

export function SkillModuleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 3.5H6.5l-3 3v4l3 3H9V9.5h6v-6h-2" />
      <path d="M15 20.5h2.5l3-3v-4l-3-3H15v4H9v6h2" />
    </svg>
  );
}
