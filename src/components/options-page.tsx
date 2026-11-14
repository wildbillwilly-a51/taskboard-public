"use client";

import Link from "next/link";
import { ArrowLeft, Monitor, Moon, SunMedium } from "lucide-react";
import { useEffect, useState } from "react";
import { useUiSettings } from "@/components/settings-provider";
import {
  type DensityMode,
  type ThemePreference,
} from "@/lib/ui-settings";

const OPTION_LABEL_CLASS = "text-[10px] font-semibold uppercase tracking-[0.14em] text-muted";
const OPTION_BODY_CLASS = "text-[10px] leading-4 text-muted";
const OPTION_SECTION_TITLE_CLASS = "text-[11px] font-semibold leading-4 tracking-[-0.01em] text-foreground";
const OPTION_CHIP_BASE_CLASS =
  "ui-chip-button ui-button-surface inline-flex items-center gap-1 rounded-[11px] border text-[11px] font-medium leading-4 transition";
const OPTION_CHIP_ACTIVE_BASE_CLASS =
  "ui-chip-button ui-chip-active inline-flex items-center gap-1 rounded-[11px] border text-[11px] font-medium leading-4 transition";
const OPTION_INPUT_BASE_CLASS =
  "ui-control w-full rounded-[8px] border text-[11px] leading-4 text-foreground outline-none transition";
const OPTION_TEXTAREA_BASE_CLASS =
  "ui-control w-full resize-y rounded-[8px] border text-[11px] leading-4 text-foreground outline-none transition";

function getOptionsDensityClasses(density: DensityMode) {
  if (density === "relaxed") {
    return {
      main: "px-2 py-2 md:px-3 md:py-3",
      pageStack: "gap-3",
      header: "rounded-[22px] px-4 py-3.5 md:rounded-[24px]",
      headerContent: "gap-2",
      grid: "gap-3",
      section: "rounded-[18px] px-3.5 py-3",
      sectionHeader: "mb-2",
      sectionControls: "space-y-2",
      formStack: "space-y-2",
      field: "gap-1",
      actionRow: "gap-1.5",
      optionGroup: "space-y-1",
      optionChoices: "gap-1",
      chip: "px-3 py-1.5",
      input: "px-2.5 py-1.5",
      textarea: "min-h-[72px] px-2.5 py-1.5",
      message: "px-2 py-1",
    };
  }

  if (density === "tight") {
    return {
      main: "px-1 py-1 md:px-1.5 md:py-1.5",
      pageStack: "gap-1.5",
      header: "rounded-[16px] px-2.5 py-2 md:rounded-[18px]",
      headerContent: "gap-1",
      grid: "gap-1.5",
      section: "rounded-[14px] px-2.5 py-2",
      sectionHeader: "mb-1",
      sectionControls: "space-y-1",
      formStack: "space-y-1",
      field: "gap-0.5",
      actionRow: "gap-1",
      optionGroup: "space-y-0.5",
      optionChoices: "gap-0.5",
      chip: "px-2 py-0.5",
      input: "px-1.5 py-0.5",
      textarea: "min-h-[56px] px-1.5 py-0.5",
      message: "px-2 py-0.5",
    };
  }

  return {
    main: "px-1.5 py-1.5 md:px-2 md:py-2",
    pageStack: "gap-2",
    header: "rounded-[18px] px-3 py-2.5 md:rounded-[20px]",
    headerContent: "gap-1.5",
    grid: "gap-2",
    section: "rounded-[16px] px-3 py-2.5",
    sectionHeader: "mb-1.5",
    sectionControls: "space-y-1.5",
    formStack: "space-y-1.5",
    field: "gap-0.5",
    actionRow: "gap-1",
    optionGroup: "space-y-0.5",
    optionChoices: "gap-0.5",
    chip: "px-2.5 py-1",
    input: "px-2 py-1",
    textarea: "min-h-[64px] px-2 py-1",
    message: "px-2 py-0.5",
  };
}

type BoardMetadata = {
  title: string;
  description: string;
};

type BoardSettingsResponse = {
  board?: BoardMetadata | null;
  error?: string;
};

export function OptionsPage({ returnTo = "/" }: { returnTo?: string }) {
  const { settings, updateSetting } = useUiSettings();
  const densityClasses = getOptionsDensityClasses(settings.density);

  return (
    <main
      className={`taskboard-shell min-h-screen ${densityClasses.main}`}
      data-density={settings.density}
    >
      <div className={`mx-auto flex w-full max-w-[1120px] flex-col ${densityClasses.pageStack}`}>
        <header
          className={`taskboard-options-header panel-surface panel-strong sticky top-0 z-40 ${densityClasses.header}`}
          data-testid="options-header"
        >
          <div className={`flex flex-col ${densityClasses.headerContent} sm:flex-row sm:items-center sm:justify-between`}>
            <div>
              <p className={OPTION_LABEL_CLASS}>
                Display settings
              </p>
              <h1 className="mt-1 text-[1.5rem] font-semibold tracking-tight text-foreground">
                Options
              </h1>
              <p className={`mt-1 ${OPTION_BODY_CLASS}`}>
                Appearance and layout preferences are saved in this browser. Board details are saved to the board.
              </p>
            </div>

            <Link
              href={returnTo}
              className={`${OPTION_CHIP_BASE_CLASS} ${densityClasses.chip}`}
            >
              <ArrowLeft className="h-3 w-3" />
              Back to previous view
            </Link>
          </div>
        </header>

        <div className={`grid ${densityClasses.grid} lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)]`}>
          <SettingsSection
            title="Board settings"
            description="Board title and description are saved to the shared board."
          >
            <BoardSettingsForm />
          </SettingsSection>

          <SettingsSection
            title="Appearance"
            description="Light or dark theme, text size, background, and panel depth."
          >
            <ThemeSetting
              value={settings.theme}
              onChange={(value) => updateSetting("theme", value)}
            />
            <OptionGroup
              label="Font scale"
              options={[
                { value: "small", label: "Small" },
                { value: "normal", label: "Normal" },
                { value: "large", label: "Large" },
                { value: "x-large", label: "X-Large" },
                { value: "xx-large", label: "XX-Large" },
              ]}
              value={settings.fontScale}
              onChange={(value) => updateSetting("fontScale", value)}
            />
            <OptionGroup
              label="Background"
              options={[
                { value: "atmospheric", label: "Atmospheric" },
                { value: "minimal", label: "Minimal" },
              ]}
              value={settings.backgroundStyle}
              onChange={(value) => updateSetting("backgroundStyle", value)}
            />
            <OptionGroup
              label="Surface treatment"
              options={[
                { value: "low", label: "Low" },
                { value: "normal", label: "Normal" },
                { value: "strong", label: "Strong" },
              ]}
              value={settings.surfaceStyle}
              onChange={(value) => updateSetting("surfaceStyle", value)}
            />
          </SettingsSection>

          <SettingsSection
            title="Board layout"
            description="How dense the board feels and how much information each card shows."
          >
            <OptionGroup
              label="Density"
              options={[
                { value: "relaxed", label: "Relaxed" },
                { value: "standard", label: "Standard" },
                { value: "tight", label: "Tight" },
              ]}
              value={settings.density}
              onChange={(value) => updateSetting("density", value)}
            />
            <OptionGroup
              label="Card detail"
              options={[
                { value: "minimal", label: "Minimal" },
                { value: "standard", label: "Standard" },
                { value: "detailed", label: "Detailed" },
              ]}
              value={settings.cardDetailLevel}
              onChange={(value) => updateSetting("cardDetailLevel", value)}
            />
            <OptionGroup
              label="Bucket width"
              options={[
                { value: "tight", label: "Tighter" },
                { value: "balanced", label: "Balanced" },
                { value: "wide", label: "Wider" },
              ]}
              value={settings.bucketWidthMode}
              onChange={(value) => updateSetting("bucketWidthMode", value)}
            />
          </SettingsSection>

          <SettingsSection
            title="Detail panel"
            description="Adjust how much room the task editor takes on the right."
          >
            <OptionGroup
              label="Sidebar width"
              options={[
                { value: "narrow", label: "Narrow" },
                { value: "normal", label: "Normal" },
                { value: "wide", label: "Wide" },
              ]}
              value={settings.sidebarWidth}
              onChange={(value) => updateSetting("sidebarWidth", value)}
            />
          </SettingsSection>

          <SettingsSection
            title="Keyboard"
            description="Ctrl+K always opens the command palette. Press ? on the board to see every shortcut."
          >
            <OptionGroup
              label="Single-key shortcuts"
              options={[
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
              value={settings.singleKeyShortcuts ? "on" : "off"}
              onChange={(value) => updateSetting("singleKeyShortcuts", value === "on")}
            />
          </SettingsSection>
        </div>
      </div>
    </main>
  );
}

function BoardSettingsForm() {
  const { settings } = useUiSettings();
  const densityClasses = getOptionsDensityClasses(settings.density);
  const [board, setBoard] = useState<BoardMetadata | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let isDisposed = false;

    const loadBoardSettings = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/api/board");
        if (!response.ok) {
          throw new Error(`Board settings request failed with ${response.status}.`);
        }

        const body = (await response.json()) as BoardSettingsResponse;
        if (!body.board) {
          throw new Error(body.error || "Board settings are unavailable.");
        }

        if (isDisposed) {
          return;
        }

        setBoard(body.board);
        setDraftTitle(body.board.title);
        setDraftDescription(body.board.description);
      } catch (loadError) {
        if (!isDisposed) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load board settings.");
        }
      } finally {
        if (!isDisposed) {
          setIsLoading(false);
        }
      }
    };

    void loadBoardSettings();

    return () => {
      isDisposed = true;
    };
  }, []);

  const handleSave = async () => {
    const title = draftTitle.trim();

    setMessage("");
    setError("");

    if (!title) {
      setError("Board title is required.");
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/board", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          description: draftDescription,
        }),
      });
      const body = (await response.json()) as BoardSettingsResponse;

      if (!response.ok || !body.board) {
        throw new Error(body.error || "Unable to save board settings.");
      }

      setBoard(body.board);
      setDraftTitle(body.board.title);
      setDraftDescription(body.board.description);
      setMessage("Board settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save board settings.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (!board) {
      return;
    }

    setDraftTitle(board.title);
    setDraftDescription(board.description);
    setMessage("");
    setError("");
  };

  return (
    <div className={densityClasses.formStack}>
      {isLoading ? (
        <p className={OPTION_BODY_CLASS}>Loading board settings...</p>
      ) : (
        <>
          <label className={`grid ${densityClasses.field}`}>
            <span className={OPTION_LABEL_CLASS}>Board title</span>
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              className={`${OPTION_INPUT_BASE_CLASS} ${densityClasses.input}`}
            />
          </label>
          <label className={`grid ${densityClasses.field}`}>
            <span className={OPTION_LABEL_CLASS}>Board description</span>
            <textarea
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              className={`${OPTION_TEXTAREA_BASE_CLASS} ${densityClasses.textarea}`}
            />
          </label>
          <div className={`flex flex-wrap justify-end ${densityClasses.actionRow}`}>
            <button
              type="button"
              onClick={handleReset}
              disabled={!board || isSaving}
              className={`${OPTION_CHIP_BASE_CLASS} ${densityClasses.chip}`}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className={`${OPTION_CHIP_ACTIVE_BASE_CLASS} ${densityClasses.chip}`}
            >
              {isSaving ? "Saving" : "Save board"}
            </button>
          </div>
        </>
      )}
      {message ? (
        <p className={`rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-medium leading-4 text-foreground ${densityClasses.message}`}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p className={`ui-danger-banner rounded-[10px] border text-[10px] font-medium leading-4 ${densityClasses.message}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const { settings } = useUiSettings();
  const densityClasses = getOptionsDensityClasses(settings.density);

  return (
    <section className={`panel-surface panel-strong ${densityClasses.section}`}>
      <div className={densityClasses.sectionHeader}>
        <h2 className={OPTION_SECTION_TITLE_CLASS}>{title}</h2>
        <p className={`mt-1 ${OPTION_BODY_CLASS}`}>{description}</p>
      </div>
      <div className={densityClasses.sectionControls}>{children}</div>
    </section>
  );
}

function ThemeSetting({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  return (
    <OptionGroup
      label="Theme"
      options={[
        { value: "light", label: "Light", icon: SunMedium },
        { value: "dark", label: "Dark", icon: Moon },
        { value: "system", label: "System", icon: Monitor },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{
    value: T;
    label: string;
    icon?: typeof SunMedium;
  }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const { settings } = useUiSettings();
  const densityClasses = getOptionsDensityClasses(settings.density);

  return (
    <div className={densityClasses.optionGroup}>
      <p className={OPTION_LABEL_CLASS}>
        {label}
      </p>
      <div className={`flex flex-wrap ${densityClasses.optionChoices}`}>
        {options.map((option) => {
          const Icon = option.icon;
          const active = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`${active ? OPTION_CHIP_ACTIVE_BASE_CLASS : OPTION_CHIP_BASE_CLASS} ${densityClasses.chip}`}
            >
              {Icon ? <Icon className="h-3 w-3" /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
