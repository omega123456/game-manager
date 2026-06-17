# Third-party acknowledgments

Game Manager is licensed under the [GNU General Public License v3.0](LICENSE). The
following third-party projects are credited for work this application builds upon
or integrates with.

## DLSS Swapper

The DLSS management feature uses the public version catalog maintained by
[DLSS Swapper](https://github.com/beeradmoore/dlss-swapper) (Brad Moore /
[beeradmoore](https://github.com/beeradmoore)).

- **Manifest:** `https://beeradmoore.github.io/dlss-swapper/manifest.json`
- **Downloads:** versioned DLL archives hosted by the DLSS Swapper project

Game Manager fetches that manifest at runtime, caches it locally, and downloads
DLL packages from the URLs it provides. Manifest format and catalog maintenance
are the work of the DLSS Swapper project; see their repository for license and
distribution terms for those artifacts.
