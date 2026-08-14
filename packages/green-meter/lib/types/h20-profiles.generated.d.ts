export interface H20Coefficients {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly nRequests: number;
    readonly r2: number;
    readonly medianRelErr: number;
}
export declare const H20_PROFILES: Readonly<Record<string, Readonly<H20Coefficients>>>;
export declare const H20_MODEL_PROFILES: Readonly<Record<string, Readonly<H20Coefficients>>>;
export declare const H20_PROXY_COEFFICIENTS: Readonly<H20Coefficients>;
//# sourceMappingURL=h20-profiles.generated.d.ts.map