/* External dependencies */
import { MatchFunction } from 'path-to-regexp';

export interface StubData {
    status: number;
    response: any;
}

export interface PatternStub {
    pattern: string;
    method: string;
    matcher: MatchFunction<Record<string, string>>;
    data: StubData;
}
