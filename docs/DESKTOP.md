# VL Lens for Windows

Extract the entire ZIP, then run VL-Lens.exe. Keep the _internal folder beside
the executable. Python and gamma are not required.

Windows 10/11 x64 and Microsoft Edge WebView2 Runtime are required. The app
is currently an unsigned preview. Local Git comparisons additionally require
Git for Windows on PATH; browsing files does not require Git.

Use File > Open project folder to browse your project. Or launch:

    VL-Lens.exe --root C:/Projects/MyVLProject

The File menu can return to the landing page or viewer. The viewer supports
Open files, Open folder, drag and drop, and Ctrl+P. Connect GitHub reads public
GitHub repositories over the internet.

Local files are parsed on this computer. The app binds its internal server
to a random loopback port and stops it when the app closes. It performs no
save, compile, checkout, fetch, stage or repository mutation actions.

For source, issues, release checksums and updates:
https://github.com/domjancik/vl-lens
