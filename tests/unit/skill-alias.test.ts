import { describe, expect, it } from 'vitest';
import { canonicalSkillName, findCatalogSkill, suggestSkills } from '@/lib/skill-alias';

const catalog = ['Python', 'SQL', 'Excel', 'Communication', 'Digital Marketing', 'JavaScript', 'HTML/CSS', 'Java',
  'PowerPoint', 'Canva', 'Teamwork', 'Public Speaking'].map((name, i) => ({ id: `id-${i}`, name }));

describe('skill aliases', () => {
  it.each([
    ['JS', 'JavaScript'], ['Javascript', 'JavaScript'], ['ES6', 'JavaScript'],
    ['HTML', 'HTML/CSS'], ['CSS', 'HTML/CSS'], ['HTML5', 'HTML/CSS'], ['CSS3', 'HTML/CSS'],
    ['Core Java', 'Java'], ['Java Programming', 'Java'],
    ['PPT', 'PowerPoint'], ['MS PowerPoint', 'PowerPoint'], ['Powerpoint', 'PowerPoint'],
    ['MS Excel', 'Excel'], ['Excel', 'Excel'], ['Advanced Excel', 'Excel'],
    ['Communication Skills', 'Communication'], ['English Communication', 'Communication'],
    ['Public Speaking', 'Public Speaking'], ['Presentation Skills', 'Public Speaking'],
    ['Team Work', 'Teamwork'], ['Team Player', 'Teamwork'],
  ])('%s -> %s', (typed, name) => {
    expect(canonicalSkillName(typed)).toBe(name);
    expect(findCatalogSkill(typed, catalog)?.name).toBe(name);
  });

  it('is case-insensitive and ignores extra spaces', () => {
    expect(findCatalogSkill('  core   JAVA ', catalog)?.name).toBe('Java');
    expect(findCatalogSkill('js', catalog)?.name).toBe('JavaScript');
    expect(findCatalogSkill('team  work', catalog)?.name).toBe('Teamwork');
  });

  it('matches catalogue names directly without an alias', () => {
    expect(findCatalogSkill('canva', catalog)?.name).toBe('Canva');
    expect(findCatalogSkill('digital marketing', catalog)?.name).toBe('Digital Marketing');
  });

  it('leaves unknown skills as typed (trimmed) and unmatched', () => {
    expect(canonicalSkillName('  AutoCAD ')).toBe('AutoCAD');
    expect(findCatalogSkill('AutoCAD', catalog)).toBeNull();
    expect(findCatalogSkill('Javanese', catalog)).toBeNull(); // no partial matches
  });
});

describe('suggestSkills (wizard autocomplete)', () => {
  it('suggests catalogue names containing the query, prefix matches first', () => {
    expect(suggestSkills('ja', catalog).map((s) => s.name)).toEqual(['Java', 'JavaScript']);
  });
  it('suggests through aliases', () => {
    expect(suggestSkills('ppt', catalog).map((s) => s.name)).toEqual(['PowerPoint']);
    expect(suggestSkills('html', catalog).map((s) => s.name)).toEqual(['HTML/CSS']);
    expect(suggestSkills('team p', catalog).map((s) => s.name)).toEqual(['Teamwork']);
  });
  it('returns nothing for an empty query and respects the limit', () => {
    expect(suggestSkills('  ', catalog)).toEqual([]);
    expect(suggestSkills('a', catalog, 3)).toHaveLength(3);
  });
});
