// GitHub action
// Copyright © 2026 Alexander Thoukydides

import assert from 'assert';

// Milliseconds in a second
export const MS = 1000;

// Type assertions
export function assertIsDefined<Type>(value: Type): asserts value is NonNullable<Type> {
    assert.notStrictEqual(value, undefined);
    assert.notStrictEqual(value, null);
}

// Format a list (with Oxford comma)
export function formatList(items: string[]): string {
    switch (items.length) {
    case 0:     return 'n/a';
    case 1:     return items[0] ?? '';
    case 2:     return `${items[0]} and ${items[1]}`;
    default:    return [...items.slice(0, -1), `and ${items[items.length - 1]}`].join(', ');
    }
}

// Format a counted noun (handling most regular cases automatically)
export function plural(count: number, noun: string | [string, string], showCount = true): string {
    const [singular, plural] = Array.isArray(noun) ? noun : [noun, ''];
    noun = count === 1 ? singular : plural;
    if (!noun) {
        // Apply regular rules
        const rules: [string, string, number][] = [
            ['on$',                 'a',   2], // phenomenon/phenomena criterion/criteria
            ['us$',                 'i',   1], //     cactus/cacti         focus/foci
            ['[^aeiou]y$',          'ies', 1], //        cty/cites         puppy/puppies
            ['(ch|is|o|s|sh|x|z)$', 'es',  0], //       iris/irises        truss/trusses
            ['',                    's',   0]  //        cat/cats          house/houses
        ];
        const rule = rules.find(([ending]) => new RegExp(ending, 'i').test(singular));
        assertIsDefined(rule);
        const matchCase = (s: string): string => singular === singular.toUpperCase() ? s.toUpperCase() : s;
        noun = singular.substring(0, singular.length - rule[2]).concat(matchCase(rule[1]));
    }
    return showCount ? `${count} ${noun}` : noun;
}

// Format a milliseconds duration
export function formatMilliseconds(ms: number, maxParts = 2): string {
    if (ms < 1) return 'n/a';

    // Split the duration into components
    const duration: [string, number][] = [
        ['day',         Math.floor(ms / (24 * 60 * 60 * MS))     ],
        ['hour',        Math.floor(ms /      (60 * 60 * MS)) % 24],
        ['minute',      Math.floor(ms /           (60 * MS)) % 60],
        ['second',      Math.floor(ms /                 MS ) % 60],
        ['millisecond', Math.floor(ms                      ) % MS]
    ];

    // Remove any leading zero components
    while (duration[0]?.[1] === 0) duration.shift();

    // Combine the required number of remaining components
    return duration.slice(0, maxParts)
        .filter(([_key, value]) => value !== 0)
        .map(([key, value]) => plural(value, key))
        .join(' ');
}

// Check whether an object is a valid Date instance
export function isValidDate(date: unknown): date is Date {
    return date instanceof Date && !Number.isNaN(date.getTime());
}