import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useDashboard } from '../context/DashboardContext';
import clsx from 'clsx';

interface TimerWizardForm {
  name: string;
  durationMinutes: number;
  dependencyCount: number;
  tags: string;
  schedule: 'immediate' | 'scheduled';
  scheduledFor?: string;
}

const steps = ['Timer details', 'Orchestration', 'Review'] as const;

type WizardStep = (typeof steps)[number];

function TimerWizard() {
  const { createTimer } = useDashboard();
  const [step, setStep] = useState<WizardStep>('Timer details');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors }
  } = useForm<TimerWizardForm>({
    defaultValues: {
      name: '',
      durationMinutes: 10,
      dependencyCount: 0,
      tags: '',
      schedule: 'immediate'
    }
  });

  const schedule = watch('schedule');

  const onSubmit = handleSubmit(async (values) => {
    setIsSubmitting(true);
    try {
      await createTimer({
        name: values.name,
        durationSeconds: Math.max(1, values.durationMinutes) * 60,
        dependencyCount: values.dependencyCount,
        tags: values.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        scheduledFor: values.schedule === 'scheduled' ? values.scheduledFor : undefined
      });
      setStep('Timer details');
    } finally {
      setIsSubmitting(false);
    }
  });

  const nextStep = () => {
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const prevStep = () => {
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/60">
      <header className="mb-6">
        <h2 className="text-lg font-semibold text-white">Timer Creation Wizard</h2>
        <p className="text-sm text-slate-400">Compose resilient timers with dependencies and launch settings.</p>
        <div className="mt-4 flex gap-2">
          {steps.map((label) => (
            <div key={label} className={clsx('flex-1 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide', step === label ? 'border-brand-500 bg-brand-500/20 text-brand-100' : 'border-slate-800 text-slate-400')}>
              {label}
            </div>
          ))}
        </div>
      </header>
      <form className="space-y-6" onSubmit={onSubmit}>
        {step === 'Timer details' && (
          <div className="grid gap-4">
            <label className="space-y-2 text-sm">
              <span className="font-semibold text-slate-200">Timer name</span>
              <input
                {...register('name', { required: 'Provide a timer name.' })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
                placeholder="Summon orchestrator"
              />
              {errors.name && <p className="text-xs text-rose-300">{errors.name.message}</p>}
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-semibold text-slate-200">Duration (minutes)</span>
              <input
                type="number"
                min={1}
                {...register('durationMinutes', { valueAsNumber: true, min: { value: 1, message: 'Duration must be positive.' } })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
              />
              {errors.durationMinutes && <p className="text-xs text-rose-300">{errors.durationMinutes.message}</p>}
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-semibold text-slate-200">Tags</span>
              <input
                {...register('tags')}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
                placeholder="ops, agent, escalation"
              />
            </label>
          </div>
        )}

        {step === 'Orchestration' && (
          <div className="grid gap-4">
            <label className="space-y-2 text-sm">
              <span className="font-semibold text-slate-200">Dependencies</span>
              <input
                type="number"
                min={0}
                {...register('dependencyCount', { valueAsNumber: true, min: { value: 0, message: 'Cannot be negative.' } })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
              />
            </label>
            <fieldset className="space-y-3 text-sm">
              <legend className="font-semibold text-slate-200">Launch mode</legend>
              <label className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <input type="radio" value="immediate" {...register('schedule')} />
                <div>
                  <p className="font-medium text-white">Start immediately</p>
                  <p className="text-xs text-slate-400">Ideal for agent-initiated work queues.</p>
                </div>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <input type="radio" value="scheduled" {...register('schedule')} />
                <div>
                  <p className="font-medium text-white">Schedule for later</p>
                  <p className="text-xs text-slate-400">Aligns with orchestrated workflows and cron templates.</p>
                </div>
              </label>
              {schedule === 'scheduled' && (
                <input
                  type="datetime-local"
                  {...register('scheduledFor', { required: 'Provide a launch time for scheduled timers.' })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
                />
              )}
              {errors.scheduledFor && <p className="text-xs text-rose-300">{errors.scheduledFor.message}</p>}
            </fieldset>
          </div>
        )}

        {step === 'Review' && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
            <p className="font-semibold text-white">Launch summary</p>
            <p className="mt-2">Review the timer blueprint before launch.</p>
            <ul className="mt-3 space-y-2 text-xs">
              <li>Name: {watch('name') || '—'}</li>
              <li>Duration: {watch('durationMinutes')} minutes</li>
              <li>Dependencies: {watch('dependencyCount')}</li>
              <li>Tags: {watch('tags') || '—'}</li>
              <li>Schedule: {watch('schedule') === 'scheduled' ? watch('scheduledFor') ?? 'Set launch time' : 'Immediate'}</li>
            </ul>
          </div>
        )}

        <footer className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={prevStep}
            disabled={step === 'Timer details'}
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 disabled:opacity-40"
          >
            Previous
          </button>
          {step !== 'Review' ? (
            <button
              type="button"
              onClick={nextStep}
              className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-brand-400"
            >
              Continue
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {isSubmitting ? 'Launching…' : 'Launch timer'}
            </button>
          )}
        </footer>
      </form>
    </section>
  );
}

export default TimerWizard;
