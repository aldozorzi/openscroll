import { describe, expect, it } from 'vitest';
import { isTechRelevant } from './tech-relevance';

describe('isTechRelevant', () => {
  it('accepts clearly technical titles', () => {
    expect(
      isTechRelevant({
        title: 'Idempotency in practice',
        content: 'Retries are safe when operations are idempotent.',
      }),
    ).toBe(true);
    expect(
      isTechRelevant({
        title: 'Software engineering is not about coding alone',
      }),
    ).toBe(true);
    expect(
      isTechRelevant({
        title: 'OpenAI releases a new model',
      }),
    ).toBe(true);
  });

  it('accepts non-obvious titles when the content has enough technical signal', () => {
    expect(
      isTechRelevant({
        title: 'Attention is not what you need',
        content:
          'The transformer model uses attention during training and inference. The architecture also changes how the network stores context.',
      }),
    ).toBe(true);
  });

  it('rejects off-topic articles even when their content mentions technology', () => {
    expect(
      isTechRelevant({
        title: 'Pentagon grants DHS permission to test heat ray weapon',
        content:
          'The system relies on computer software, a network, and a custom database.',
      }),
    ).toBe(false);
    expect(
      isTechRelevant({
        title: "Review: Crystal Lake suffers from its horror prequel obsession",
        content: 'The streaming platform released the movie this week.',
      }),
    ).toBe(false);
    expect(
      isTechRelevant({
        title: "The reactor meant to showcase nuclear's comeback",
        content: 'Engineers use software and sensors to monitor the plant.',
      }),
    ).toBe(false);
    expect(
      isTechRelevant({
        title: 'Ukraine learns to fight without Starlink',
        content: 'Drones and satellite communications are part of the story.',
      }),
    ).toBe(false);
  });

  it('rejects science and space stories that mention technology', () => {
    expect(
      isTechRelevant({
        title: 'A 1,000-mile cloud on Mars may reveal physics never seen in nature',
        content:
          'The model uses computer simulations and data from a spacecraft.',
      }),
    ).toBe(false);
    expect(
      isTechRelevant({
        title: 'NASA updates lander plans for Moon landings',
        content:
          'Engineers rely on software, hardware, and a database of telemetry.',
      }),
    ).toBe(false);
    expect(
      isTechRelevant({
        title: 'Crows can evaluate visual info twice as fast as mammals',
        content: 'The study measured neural latency and hardware performance.',
      }),
    ).toBe(false);
    expect(
      isTechRelevant({
        title: 'Ice sheet expansion may have started 2,000 years ago',
        content: 'Researchers combined data, models, and geochronology.',
      }),
    ).toBe(false);
  });

  it('rejects general-interest content without technical signal', () => {
    expect(
      isTechRelevant({
        title: "Dolly Parton's Imagination Library opens a new chapter",
        content:
          'The library mailed books to children and celebrated reading in local communities.',
      }),
    ).toBe(false);
    expect(
      isTechRelevant({
        title: 'Where the Romans fought',
        content:
          'Historians walked the battlefield and described the legions and their camps.',
      }),
    ).toBe(false);
  });

  it('matches short terms only as whole words', () => {
    expect(
      isTechRelevant({
        title: 'She said hello to the crowd',
        content: 'The speaker shared stories about the town and its people.',
      }),
    ).toBe(false);
    expect(
      isTechRelevant({
        title: 'Scenarios for the next decade',
        content: 'The report describes possible futures for the region.',
      }),
    ).toBe(false);
  });
});
