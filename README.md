# mg-mirror

Static Hugo mirror of the Mathematics Genealogy Project: **338,532 records**.

Site: [mg.ncag.info](https://mg.ncag.info/).
Data: [Erdos-Projects/summer26-math-genealogy](https://github.com/Erdos-Projects/summer26-math-genealogy), pinned and checksum-verified. No predicted subject labels.

Requires Hugo 0.158+ and Python 3.10+.

```sh
make serve   # localhost:1313; downloads the snapshot on first run
make build
make check
```

GitHub Actions builds and deploys `main` to GitHub Pages. Generated data and HTML are not committed.
