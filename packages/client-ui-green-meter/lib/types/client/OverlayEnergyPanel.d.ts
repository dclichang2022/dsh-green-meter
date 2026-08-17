import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Full panel props: shell.overlay owner share + locale seat. */
export type OverlayEnergyPanelProps = PropsRuntime<'shell.overlay'> & PropsLocale<'greenMeter'>;
/** The overlay drawer panel; closed/absent states render nothing. */
export declare function OverlayEnergyPanel({ t }: OverlayEnergyPanelProps): import("react").JSX.Element | null;
//# sourceMappingURL=OverlayEnergyPanel.d.ts.map