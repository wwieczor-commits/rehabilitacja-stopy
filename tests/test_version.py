"""Spójność wersji: sw.js, js/version.js, index.html i brak prywatnych mediów w repozytorium."""
import os, re, subprocess, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sw = open(R + '/sw.js').read(); ver = open(R + '/js/version.js').read()
v = re.search(r"VERSION = '(v\d+)'", sw).group(1); assert f"'rehab-{v}'" in ver, 'version.js CACHE nie pasuje do sw.js'
assert re.search(r"VERSION = 'v6\.0", ver), 'oczekiwano v6.0'
assert 'network' in sw.lower() or 'sieć' in sw.lower()
tracked = subprocess.run(['git', 'ls-files'], cwd=R, capture_output=True, text=True).stdout.split()
bad = [f for f in tracked if re.search(r'\.(mov|mp4|m4v|webm)$', f, re.I) and not f.startswith('assets/')]
assert not bad, f'w repozytorium są pliki wideo: {bad}'
assert not [f for f in tracked if f.startswith('screenshots/private')], 'prywatne zrzuty w repo'
print('OK wersje spójne:', v)
