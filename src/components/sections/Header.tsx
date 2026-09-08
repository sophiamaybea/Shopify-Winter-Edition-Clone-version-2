import { PillButton } from "@/components/ui/Button";

function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M12 7v10M8.2 9.6c0-1.4 1.6-2.4 3.8-2.4s3.8 1 3.8 2.4-1.6 1.9-3.8 2.4-3.8 1-3.8 2.4 1.6 2.4 3.8 2.4 3.8-1 3.8-2.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-3.5">
      <div
        className="flex min-w-0 flex-1 items-center gap-6 text-white"
        style={{ mixBlendMode: "difference" }}
      >
        <a
          href="#top"
          className="flex min-w-0 shrink items-center gap-2 truncate text-sm font-semibold whitespace-nowrap"
        >
          <Logo />
          <span className="truncate">Bea Sophia</span>
          <span className="hidden font-normal text-white/60 sm:inline">
            Writing School
          </span>
        </a>
        <nav className="hidden items-center gap-6 text-sm glg:flex">
          <button className="flex items-center gap-1">
            Courses
            <svg width="9" height="6" viewBox="0 0 9 6" fill="none" aria-hidden>
              <path
                d="M1 1l3.5 3.5L8 1"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button className="flex items-center gap-1.5">
            The Method
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="5.2" cy="5.2" r="4" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8.5 8.5L11 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </nav>
      </div>
      <div
        className="hidden items-center gap-6 text-sm text-white sm:flex"
        style={{ mixBlendMode: "difference" }}
      >
        <a href="#">My Writing</a>
      </div>
      <div className="shrink-0">
        <PillButton>Try it free</PillButton>
      </div>
    </header>
  );
}
