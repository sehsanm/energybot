import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function LandingPage() {
  return (
    <main className="relative overflow-hidden">
      {/* Decorative background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 grid-bg" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-24 -z-10 h-96 w-96 rounded-full opacity-30 blur-3xl animate-blob-pulse"
        style={{ background: "radial-gradient(closest-side, hsl(var(--accent)), transparent)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-20 -z-10 h-[28rem] w-[28rem] rounded-full opacity-25 blur-3xl animate-blob-pulse"
        style={{ background: "radial-gradient(closest-side, hsl(var(--primary)), transparent)" }}
      />

      <Header />

      <Hero />

      <Benefits />

      <HowItWorks />

      <FinalCTA />

      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="container flex items-center justify-between py-6">
      <Link href="/" className="flex items-center gap-2 group">
        <LogoMark />
        <span className="text-base font-bold tracking-tight">انرژی‌بات</span>
      </Link>
      <nav className="flex items-center gap-2">
        <a
          href="#how"
          className="hidden sm:inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          نحوه استفاده
        </a>
        <a
          href="#features"
          className="hidden sm:inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          ویژگی‌ها
        </a>
        <ThemeToggle />
      </nav>
    </header>
  );
}

function LogoMark() {
  return (
    <span
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl text-primary-foreground"
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 60%, hsl(var(--success)) 100%)",
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
      </svg>
    </span>
  );
}

function Hero() {
  return (
    <section className="container relative pt-10 pb-20 sm:pt-16 sm:pb-28">
      <div className="mx-auto max-w-3xl text-center animate-fade-in-up">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
          در بله فعال است
        </span>
        <h1 className="mt-6 text-balance text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl md:text-6xl">
          صرفه‌جویی <span className="gradient-text">هوشمند</span> در
          <br className="hidden sm:block" /> برق و گاز خانه‌ی شما
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-loose text-muted-foreground sm:text-lg">
          انرژی‌بات، دستیار فارسی‌زبان شماست که در پیام‌رسان <strong className="text-foreground">بله</strong> با شما گفت‌وگو می‌کند،
          پروفایل خانه‌تان را می‌سازد و راهکارهای کاربردی برای کاهش قبض ارائه می‌دهد.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="https://ble.ir/AvidEnergybot"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background shadow-lg transition hover:opacity-90 cursor-pointer"
          >
            شروع گفتگو در بله
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition group-hover:-translate-x-0.5" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </a>
          <a
            href="#features"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-card/70 px-6 text-sm font-semibold text-foreground backdrop-blur transition hover:bg-card cursor-pointer"
          >
            بیشتر بدانید
          </a>
        </div>

        <dl className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-4 text-center">
          <Stat label="پاسخ فارسی" value="۱۰۰٪" />
          <Stat label="پروفایل خانه" value="شخصی" />
          <Stat label="بدون نصب اپ" value="در بله" />
        </dl>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-bold sm:text-xl">{value}</dd>
    </div>
  );
}

function Benefits() {
  const items = [
    {
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 21a8 8 0 0 0-16 0" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
      title: "توصیه‌های شخصی",
      body:
        "بر اساس متراژ، نوع سیستم گرمایش و سرمایش و عادت‌های مصرف، راهکارهای واقع‌بینانه برای خانه‌ی شما پیشنهاد می‌دهد.",
      tint: "primary",
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z" />
        </svg>
      ),
      title: "دانش معتبر",
      body:
        "پاسخ‌ها بر پایه‌ی پایگاه دانش فارسی منتخب درباره‌ی برق و گاز ساخته می‌شوند؛ نه حدس، نه شایعه.",
      tint: "accent",
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
        </svg>
      ),
      title: "ساده و در دسترس",
      body:
        "فقط با یک پیام در بله شروع کنید. بدون نصب اپ، بدون فرم طولانی، با زبان فارسی روان.",
      tint: "success",
    },
  ] as const;

  return (
    <section id="features" className="container py-16 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">چرا انرژی‌بات؟</h2>
        <p className="mt-4 text-muted-foreground">
          سه دلیل ساده که چرا گفتگو با انرژی‌بات از جست‌وجوی کلی در اینترنت بهتر است.
        </p>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <BenefitCard key={it.title} icon={it.icon} title={it.title} body={it.body} tint={it.tint} />
        ))}
      </div>
    </section>
  );
}

function BenefitCard({
  icon,
  title,
  body,
  tint,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tint: "primary" | "accent" | "success";
}) {
  const tintBg =
    tint === "primary"
      ? "bg-primary/10 text-primary"
      : tint === "accent"
      ? "bg-accent/10 text-accent"
      : "bg-success/10 text-success";
  return (
    <article className="group relative rounded-2xl border border-border bg-card p-6 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${tintBg}`}>{icon}</span>
      <h3 className="mt-5 text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-loose text-muted-foreground">{body}</p>
    </article>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "۱",
      title: "بات را در بله باز کنید",
      body: "بدون نصب اپ اضافه. کافی است در پیام‌رسان بله، انرژی‌بات را پیدا و گفتگو را شروع کنید.",
    },
    {
      n: "۲",
      title: "پروفایل خانه را تکمیل کنید",
      body: "چند پرسش کوتاه درباره‌ی متراژ، سیستم گرمایش/سرمایش و دغدغه‌ی اصلی شما در مصرف انرژی.",
    },
    {
      n: "۳",
      title: "توصیه‌های شخصی بگیرید",
      body: "از همان لحظه می‌توانید سؤال بپرسید و راهکارهای ساده و عملی برای کاهش قبض دریافت کنید.",
    },
  ];

  return (
    <section id="how" className="container py-16 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">در سه گام شروع کنید</h2>
        <p className="mt-4 text-muted-foreground">
          فرایند ساده است. در کمتر از دو دقیقه به اولین توصیه‌ی شخصی‌سازی‌شده می‌رسید.
        </p>
      </div>

      <ol className="mt-12 grid gap-5 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="relative rounded-2xl border border-border bg-card p-6">
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-base font-extrabold text-primary-foreground"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)",
              }}
              aria-hidden="true"
            >
              {s.n}
            </span>
            <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
            <p className="mt-2 text-sm leading-loose text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="container pb-20 sm:pb-28">
      <div
        className="relative overflow-hidden rounded-3xl border border-border p-8 text-center sm:p-14"
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--accent) / 0.08) 60%, hsl(var(--success) / 0.08))",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-48 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(closest-side, hsl(var(--accent)), transparent)" }}
        />
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          آماده‌اید قبض ماه آینده را کاهش دهید؟
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          همین حالا گفتگو با انرژی‌بات را در بله شروع کنید. رایگان، فارسی و در همان پیام‌رسانی که هر روز استفاده می‌کنید.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="https://ble.ir/AvidEnergybot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background shadow-lg transition hover:opacity-90 cursor-pointer"
          >
            شروع گفتگو در بله
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/70">
      <div className="container flex flex-col items-center justify-between gap-4 py-8 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span>انرژی‌بات — دستیار صرفه‌جویی انرژی</span>
        </div>
        <div className="flex items-center gap-5">
          <a href="/admin/" className="transition hover:text-foreground">
            ورود مدیران
          </a>
          <span aria-hidden>·</span>
          <span>۱۴۰۵</span>
        </div>
      </div>
    </footer>
  );
}
