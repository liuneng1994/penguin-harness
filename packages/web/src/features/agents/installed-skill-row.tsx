/** One installed skill: activity, an immediate switch, export and uninstall. */
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import {
  DownloadIcon,
  GlyphIcon,
  ICONS,
  IconButton,
  ICON_SIZE,
  ListRow,
  Pill,
  Switch,
} from "@prismshadow/penguin-ui";
import { useInstantSetting } from "../../lib/instant-setting";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { localizedShortText } from "../chat/skill-use";
import { SkillTile } from "../skills/skill-icon-view";

export function InstalledSkillRow({
  skill,
  busy,
  onEnabledChange,
  onExport,
  onRemove,
}: {
  skill: SkillMetadataItem;
  busy: boolean;
  onEnabledChange: (enabled: boolean) => Promise<unknown>;
  onExport: () => void;
  onRemove: () => void;
}) {
  const { locale } = useLocale();
  const enabled = useInstantSetting(skill.enabled !== false, onEnabledChange);
  const usage = skill.usage;
  return (
    <ListRow
      as="li"
      leading={<SkillTile icon={skill.icon} name={skill.name} />}
      title={
        <span className="inline-flex max-w-full items-center gap-2">
          <span className="truncate font-mono text-[length:var(--ui-text-code-size)] font-semibold">
            {skill.name}
          </span>
          {!enabled.value && <Pill tone="neutral">{S.skills.disabled}</Pill>}
        </span>
      }
      description={
        <span
          data-tooltip={skill.description}
          data-tooltip-content="text"
          data-tooltip-extra={skill.description !== localizedShortText(locale, skill)}
        >
          {localizedShortText(locale, skill)}
        </span>
      }
      meta={
        <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
          {skill.version && <span>{skill.version}</span>}
          {usage && (
            <>
              <span>{S.skills.invocations(usage.invocations)}</span>
              <span>{S.skills.reads(usage.reads)}</span>
              {usage.failedReads > 0 && <span>{S.skills.failedReads(usage.failedReads)}</span>}
              <span>{S.skills.sessions(usage.sessions)}</span>
              <span>
                {S.skills.lastUsed(
                  usage.lastUsedAt === null ? S.skills.neverUsed : formatDateTime(usage.lastUsedAt),
                )}
              </span>
            </>
          )}
        </span>
      }
      trailing={
        <>
          <Switch
            checked={enabled.value}
            disabled={busy || enabled.busy}
            onChange={(next) => void enabled.set(next)}
            aria-label={S.skills.enableSkill(skill.name)}
            title={
              enabled.value ? S.skills.disableSkill(skill.name) : S.skills.enableSkill(skill.name)
            }
          />
          <IconButton
            label={`${S.skills.exportSkill} ${skill.name}`}
            title={S.skills.exportSkill}
            disabled={busy || enabled.busy}
            onClick={onExport}
          >
            <DownloadIcon size={ICON_SIZE.iconButton} />
          </IconButton>
          <IconButton
            variant="danger"
            label={`${S.skills.uninstall} ${skill.name}`}
            title={S.skills.uninstall}
            disabled={busy || enabled.busy}
            onClick={onRemove}
          >
            <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
          </IconButton>
        </>
      }
    />
  );
}
