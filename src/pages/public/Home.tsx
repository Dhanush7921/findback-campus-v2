import { ArrowRight, BadgeCheck, BarChart3, GraduationCap, Lock, MapPin, PackageCheck, PlayCircle, ShieldCheck, Smartphone, Sparkles, UserCog, UserRound, Users } from 'lucide-react';
import { Link } from 'react-router';
import { HeroArt } from '../../components/art';
import { ButtonLink, Card } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

export default function Home() {
  const { t } = useI18n();
  const features = [
    [Lock, t('home.f1t'), t('home.f1d')],
    [Users, t('home.f2t'), t('home.f2d')],
    [ShieldCheck, t('home.f3t'), t('home.f3d')],
    [Smartphone, t('home.f4t'), t('home.f4d')],
  ] as const;
  const steps = [
    ['01', t('how.s1t'), t('how.s1d')],
    ['02', t('how.s4t'), t('how.s4d')],
    ['03', t('how.s6t'), t('how.s6d')],
  ];
  return (
    <>
      <section className="safe-x mx-auto grid max-w-6xl items-center gap-10 pb-10 pt-10 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:gap-6">
        <div className="animate-rise">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white/80 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-teal-800 shadow-sm">
            <MapPin className="h-3.5 w-3.5" aria-hidden /> {t('home.eyebrow')}
          </p>
          <h1 className="text-[2.35rem] font-extrabold leading-[1.08] sm:text-5xl lg:text-[3.6rem]">
            {t('home.title1')}<br /><span className="brand-text">{t('home.title2')}</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-500">{t('home.lead')}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/student" size="lg">{t('v2.studentT')} <ArrowRight className="h-5 w-5" /></ButtonLink>
            <ButtonLink to="/guest" size="lg" variant="secondary">{t('v2.guestT')}</ButtonLink>
            <ButtonLink to="/demo" size="lg" variant="soft" data-testid="explore-demo"><PlayCircle className="h-5 w-5" /> Explore Demo</ButtonLink>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-500">
            {[[Smartphone, t('home.trust1')], [Lock, t('home.trust2')], [BadgeCheck, t('home.trust3')]].map(([Icon, label]) => {
              const I = Icon as typeof Lock;
              return <li key={label as string} className="flex items-center gap-2"><I className="h-4 w-4 text-teal-600" aria-hidden />{label as string}</li>;
            })}
          </ul>
        </div>
        <HeroArt className="mx-auto w-full max-w-[520px]" />
      </section>


      <section className="safe-x mx-auto max-w-6xl pb-6">
        <div className="overflow-hidden rounded-[2rem] bg-[#0b1026] p-6 text-white shadow-2xl shadow-violet-950/20 sm:p-8">
          <div className="grid items-center gap-6 lg:grid-cols-[1.2fr_.8fr]">
            <div><p className="inline-flex items-center gap-2 rounded-full bg-violet-500/20 px-3 py-1.5 text-xs font-extrabold uppercase tracking-[.14em] text-violet-200"><Sparkles className="h-4 w-4" /> Public V2 demo · no real data</p><h2 className="mt-4 text-2xl font-extrabold text-white sm:text-3xl">Explore every role without Firebase or a real college account.</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">Use fictional browser-only records to submit reports, register found items, verify claims, upload receiver proof and inspect read-only management analytics.</p><ButtonLink to="/demo" size="lg" className="mt-6 !bg-violet-600 hover:!bg-violet-500">Launch interactive demo <ArrowRight className="h-5 w-5" /></ButtonLink></div>
            <div className="grid grid-cols-2 gap-3">{[[GraduationCap, 'Student'], [UserRound, 'Guest'], [PackageCheck, 'Main Admin'], [BarChart3, 'Management']].map(([Icon, label]) => { const I = Icon as typeof UserRound; return <div key={label as string} className="rounded-2xl border border-white/10 bg-white/[.06] p-4"><I className="h-5 w-5 text-violet-300" /><p className="mt-2 text-sm font-bold text-white">{label as string}</p></div>; })}</div>
          </div>
        </div>
      </section>

      <section className="safe-x mx-auto max-w-6xl py-6" aria-labelledby="entry-title">
        <h2 id="entry-title" className="mb-6 text-2xl font-extrabold sm:text-3xl">{t('v2.entryTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['/student', GraduationCap, t('v2.studentT'), t('v2.studentD'), 'from-emerald-500 to-teal-500'],
            ['/guest', UserRound, t('v2.guestT'), t('v2.guestD'), 'from-teal-500 to-cyan-500'],
            ['/staff', UserCog, t('v2.adminT'), t('v2.adminD'), 'from-cyan-600 to-sky-500'],
            ['/management', BarChart3, t('v2.mgmtT'), t('v2.mgmtD'), 'from-sky-600 to-blue-500'],
          ] as const).map(([to, Icon, title, text, grad], i) => (
            <Link key={to} to={to} className="card group flex flex-col p-6 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] focus-visible:shadow-[var(--shadow-lift)] animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
              <span className={`mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${grad} text-white shadow-sm`}><Icon className="h-6 w-6" aria-hidden /></span>
              <span className="font-display text-lg font-bold text-ink-900">{title}</span>
              <span className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-500">{text}</span>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700">{t('v2.continue')} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="safe-x mx-auto max-w-6xl py-12">
        <h2 className="mb-8 text-2xl font-extrabold sm:text-3xl">{t('home.featuresTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(([Icon, title, text], i) => (
            <Card key={title} className="group p-6 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] animate-rise" style={{ animationDelay: `${i * 70}ms` }}>
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-50 to-sky-50 text-teal-700 ring-1 ring-teal-100"><Icon className="h-6 w-6" aria-hidden /></div>
              <h3 className="font-bold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="safe-x mx-auto max-w-6xl py-12">
        <div className="card overflow-hidden p-0">
          <div className="grid lg:grid-cols-[1fr_1.4fr]">
            <div className="brand-gradient p-8 text-white sm:p-10">
              <h2 className="text-2xl font-extrabold text-white sm:text-3xl">{t('home.stepsTitle')}</h2>
              <p className="mt-3 text-white/85">{t('how.lead')}</p>
              <ButtonLink to="/how-it-works" variant="secondary" className="mt-6">{t('nav.how')} <ArrowRight className="h-4 w-4" /></ButtonLink>
            </div>
            <ol className="grid gap-px bg-silver-100 sm:grid-cols-3">
              {steps.map(([n, title, text]) => (
                <li key={n} className="bg-white p-7">
                  <span className="font-display text-3xl font-extrabold text-teal-200">{n}</span>
                  <h3 className="mt-2 font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="safe-x mx-auto max-w-6xl py-8">
        <Card className="flex flex-col items-start gap-4 bg-gradient-to-r from-white to-teal-50/60 p-7 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">{t('home.ctaBandTitle')}</h2>
            <p className="mt-1 text-sm text-ink-500">{t('home.ctaBandText')}</p>
          </div>
          <ButtonLink to="/help" variant="soft">{t('nav.help')}</ButtonLink>
        </Card>
      </section>
    </>
  );
}
