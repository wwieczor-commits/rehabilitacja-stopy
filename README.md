# Rehabilitacja stopy

Aplikacja przeglądarkowa (PWA) do **pomiaru zakresu ruchu stopy i kostki** podczas rehabilitacji po urazie.
Kamera telefonu lub nagrany film → kąt zgięcia grzbietowego/podeszwowego, zakres ruchu, liczba powtórzeń,
historia postępów i raport PDF. Wszystko działa lokalnie w przeglądarce – **obraz nie jest nigdzie wysyłany**.

**Aplikacja:** https://wwieczor-commits.github.io/rehabilitacja-stopy/

© Wojciech Wieczorek · Rehabilitacja stopy – prototyp. Logo i kolory: BikeRc.

> ⚠️ Wartości są orientacyjne i **nie stanowią diagnozy medycznej**. Pomiar z kamery 2D nie zastępuje goniometru.
> Zakres i rodzaj ćwiczeń skonsultuj z fizjoterapeutą lub lekarzem.

## Co potrafi (wersja 6)

Jeden przepływ: **① Wczytaj film / Kamera → ② automatyczne wykrywanie stopy (popraw punkty przeciągnięciem) → ③ wynik → ④ Raport PDF.**

- **Automatyczne wykrywanie stopy i kostki bez widocznej całej sylwetki** – model **RTMW‑m** (133 punkty ciała/stóp, COCO‑WholeBody,
  onnxruntime‑web, WASM; plik `assets/models/rtmw-m.onnx` leży w repozytorium, nic nie jest wysyłane do sieci). Stopa jest
  szukana w obróconych wycinkach kadru, potem śledzona klatka po klatce. Kąt kostki liczony jest z osi stopy (pięta/kostka → palec)
  względem osi goleni (z kolana, jeśli widać; inaczej prostopadle do stopy – można ją zmienić przyciskiem „Zamień kierunek goleni”
  albo przeciągnięciem żółtego uchwytu).
- **Wczytywanie filmów, które po prostu działa** – .MOV/.MP4/.M4V z iPhone’a (pionowe, poziome, metadane obrotu, HEVC i H.264),
  Safari i Chrome na Macu i iPhonie. Film jest czytany deterministycznie klatka po klatce (z paskiem postępu), a gdy przeglądarka
  nie umie go zdekodować (np. HEVC w Chrome), aplikacja sama go **konwertuje w przeglądarce** (ffmpeg.wasm, lokalnie, do H.264 ≤960 px).
- **Tryb ręczny (3 punkty)** z śledzeniem korelacją obrazu – awaryjnie, gdy automat się myli. Punkty można przeciągać.
- **Kamera na żywo** – to samo wykrywanie w czasie rzeczywistym, „Start pomiaru” / „Stop”.
- **Raport PDF** (jsPDF, polskie fonty): logo, pacjent/data, KPI, klatki z maks. i min. kąta **z bieżącego filmu**, wykres kąta w czasie,
  historia i postępy, porównanie nogi po urazie i zdrowej, uwagi. Zapisuje się **automatycznie po pomiarze** (przełącznik)
  oraz przyciskiem „Zapisz raport PDF” (na telefonie: dolny pasek).
- **Historia** (`localStorage`, `rehab.sessions.v1`) z eksportem/importem JSON i CSV; ustawienia z wersji 5 są migrowane.
- **Trener głosowy** (poniżej), PWA (instalacja, praca offline po pierwszym wejściu; service worker `v6`, sieć‑najpierw dla kodu).
- Układ: duże przyciski, na telefonie lepki dolny pasek **Film / Kamera / Raport PDF**, nic nie wychodzi poza ekran
  także przy filmie pionowym na laptopie. Wersja widoczna w stopce (`v6.0 · 2026-11-01`).

## Jak nagrywać

- Telefon stabilnie, **z boku** na wysokości kostki, prostopadle do płaszczyzny ruchu; w kadrze cała stopa (kolano pomaga, ale nie jest konieczne).
- Kontrastowe tło, dobre światło, brak ruchu kamery w trakcie serii. Film do ~2 min (dłuższy jest skracany).

## Uruchomienie lokalne

```bash
python3 -m http.server 8766   # i otwórz http://127.0.0.1:8766/
```

Kamera wymaga HTTPS albo `localhost`. Wszystko (model, ONNX Runtime, ffmpeg.wasm, jsPDF, fonty) jest w `assets/` – bez CDN.
Układ plików: `index.html`, `style.css`, `js/` (`app` – interfejs, `pose` – model i śledzenie stopy, `video` – wczytywanie filmów,
`convert` – konwersja ffmpeg.wasm, `metrics` – kąty/zakres/powtórzenia, `report` – PDF, `store` – historia), `tracker.js` (tryb ręczny).

## Trener głosowy (w tle)

Podczas ćwiczenia aplikacja mówi po polsku (Web Speech API, głos pl-PL): wprowadzenie do ćwiczenia, odliczanie 3-2-1 przed pomiarem
z kamery, liczenie powtórzeń na głos („1… 2… ostatnie powtórzenie”), utrzymanie („trzymaj… 3, 2, 1, rozluźnij”), podpowiedzi tempa
(„teraz w dół / w górę”), zakończenie serii i odliczanie przerwy (pole *Przerwa między seriami*), zachęty, ostrzeżenia
(spadek zakresu ruchu, utrata śledzenia – „popraw punkty”), podsumowanie sesji z zakresem względem poprzedniej oraz spokojne
przypomnienia: przy bólu przerwij, cele ustala fizjoterapeuta. To wsparcie motywacyjne, nie porada medyczna.
Ustawienia (🎙): włącz/wyłącz, głośność, tempo, wybór głosu, szczegółowość *minimalna / normalna / gadatliwa*, „Test głosu”;
🔊 wycisza (na podglądzie i w dolnym pasku). Zapis w `localStorage` (`bikerc.coach.v1`). Moduł `assets/coach.js`
jest wspólny z aplikacją „BikeRc Motion”. Na iOS pierwsze dotknięcie ekranu odblokowuje dźwięk.
Test: `python3 tests/test_coach.py` (speechSynthesis podmieniony na szpiega).

## Testy

- `python3 tests/test_version.py` – spójność wersji (sw.js ↔ js/version.js) i brak filmów w repozytorium.
- `python3 tests/test_e2e.py [chromium|webkit|all]` – Playwright, prawdziwe kliknięcia, desktop + telefon, film poziomy i pionowy
  (syntetyczny, generowany przez `tests/make_synth.py`; żadnych prywatnych nagrań), automatyczny PDF, historia, brak przewijania poziomego.
- `python3 tests/perf_long.py 3` – kilka pomiarów pod rząd: płynność odtwarzania i czas analizy nie mogą się pogarszać.

## Ograniczenia

Prototyp, wartości orientacyjne. Pomiar 2D z kamery zależy od ustawienia kamery; nie porównywano go z goniometrem.
Domyślna oś goleni (gdy kolano nie jest widoczne) jest zgadywana jako prostopadła do stopy – sprawdź żółty uchwyt.
Model może się mylić na rysunkach/bardzo rozmytych ujęciach – wtedy użyj trybu ręcznego.
