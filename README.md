# Rehabilitacja stopy

Aplikacja przeglądarkowa (PWA) do **pomiaru zakresu ruchu stopy i kostki** podczas rehabilitacji po urazie.
Kamera telefonu lub nagrany film → kąt zgięcia grzbietowego/podeszwowego, zakres ruchu, liczba powtórzeń,
historia postępów i raport PDF. Wszystko działa lokalnie w przeglądarce – **obraz nie jest nigdzie wysyłany**.

**Aplikacja:** https://wwieczor-commits.github.io/rehabilitacja-stopy/

© Wojciech Wieczorek · Rehabilitacja stopy – prototyp. Logo i kolory: BikeRc.

> ⚠️ Wartości są orientacyjne i **nie stanowią diagnozy medycznej**. Pomiar z kamery 2D nie zastępuje goniometru.
> Zakres i rodzaj ćwiczeń skonsultuj z fizjoterapeutą lub lekarzem.

## Co potrafi

- **Dwa tryby pomiaru**
  - **Cała noga (MediaPipe PoseLandmarker)** – model wyznacza kolano, kostkę, piętę i palce (strona lewa/prawa/auto).
  - **Zbliżenie stopy** – gdy film pokazuje tylko stopę (bez kolana) lub model nie wykrywa sylwetki: stukasz **3 punkty**
    (A – oś goleni, B – kostka boczna, C – przodostopie), a aplikacja śledzi je w filmie (korelacja fragmentów obrazu, czysty JS,
    bez modelu). Kąt między odcinkami nie zależy od drżenia kamery (niezmienniczość względem obrotu). Dryf można poprawić
    przeciągnięciem punktu. Aplikacja sama podpowiada ten tryb, gdy przez kilka sekund nie widzi sylwetki.
- **Kąt kostki** względem pozycji neutralnej 90° (+ zgięcie grzbietowe, − podeszwowe), na żywo oraz min/maks/zakres; kąt kolana.
  Przycisk **„Ustaw pozycję neutralną”**.
- **Ćwiczenia** z instrukcją po polsku i rysunkiem: pompowanie stopą, wspięcie na palce, przysiad przy ścianie (knee-to-wall).
  Licznik powtórzeń, progi, cel zakresu, czas utrzymania, cel sesji (np. 3×15).
- Eksperymentalnie: **inwersja/ewersja** z widoku od przodu.
- **Porównanie nogi zdrowej i po urazie** (zakres, deficyt %, asymetria).
- **Historia i postępy** (localStorage): tabela, wykres po dniach, eksport/import **JSON** i **CSV**.
- **Raport PDF „Raport rehabilitacji stopy”**: sesje, tabela zakresów, wykres postępu, klatki w maks. zgięciu grzbietowym i podeszwowym,
  porównanie L/P, wartości orientacyjne, zastrzeżenie. Przykład: `screenshots/raport-przyklad.pdf`.
- **Film z pliku** z kontrolkami: 0,25/0,5/1×, krok o klatkę, przewijanie. Przy filmach z iPhone’a w HEVC, których przeglądarka
  nie odtworzy, pojawia się polski komunikat (zapisz jako „Najbardziej zgodny”/MP4 H.264).
- Telefon: dolny pasek **Kamera / Film / Pomiar / Pełny**, pełny ekran, PWA (instalacja, praca offline po pierwszym wejściu).

## Jak nagrywać (podpowiedzi także w aplikacji)

- Telefon oprzyj stabilnie (statyw, stos książek) **na wysokości kostki**, **prostopadle** do płaszczyzny ruchu stopy (widok z boku).
- Jeśli się da, w kadrze zostaw **kolano** i całą stopę – wtedy działa tryb „Cała noga”. Bliskie ujęcie samej stopy → tryb „Zbliżenie stopy”.
- Kontrastowe tło (jasna stopa – ciemne tło lub odwrotnie), dobre światło, bez ruchu kamery w trakcie serii.
- Przy trybie zbliżenia wskazuj punkty na skórze (nie na samej krawędzi na tle) i ustaw pozycję neutralną.

## Uruchomienie lokalne

Statyczna strona bez budowania:

```bash
python3 -m http.server 8766   # i otwórz http://127.0.0.1:8766/
```

Kamera wymaga HTTPS albo `localhost`. Biblioteki (MediaPipe Tasks Vision 0.10.21, jsPDF 2.5.2) ładują się z CDN,
z lokalnym zapasem w `assets/`.

## Testy

`tests/test_app.py` (Playwright + Chrome; filmy testowe nie są w repozytorium), `tests/smoke.py`, `tests/run_cu.py` (zbliżenie).
`tests/sample-history.json` – syntetyczne dane demonstracyjne do importu.

## Ograniczenia

Prototyp. Pomiar 2D z kamery zależy od ustawienia kamery i wyboru punktów; nie był porównywany z goniometrem.
Śledzenie w trybie zbliżenia może dryfować przy szybkich ruchach lub zmianie oświetlenia – popraw punkty przeciągnięciem.
